// All game audio is synthesized at runtime with the Web Audio API — no sound files.
// 3D positional (HRTF), procedural reverb per level, occlusion muffling, and adaptive fear layers.

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.9;
    this.loops = [];
    this.timers = [];
    this.chase = 0;
    this.fear = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.5;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.send = ctx.createGain(); this.send.connect(this.verb);
    this.buildIR(1.4);
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.pink = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), p = this.pink.getChannelData(0), br = this.brown.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + x * 0.5362) * 0.11;
      last = (last + 0.02 * x) / 1.02; br[i] = last * 3.5;
    }
    this.distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.distCurve[i] = Math.tanh(x * 4); }
    this.listener = ctx.listener;
    this.enabled = true;
    this.startBodyLoops();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  buildIR(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * Math.max(0.3, seconds));
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections + diffuse tail
        const early = i < ctx.sampleRate * 0.06 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * 0.6 + early);
      }
    }
    this.verb.buffer = ir;
  }

  // ---------- building blocks ----------
  now() { return this.ctx.currentTime; }
  out(pos, opts = {}) {
    // returns a node to connect a source into; handles panning, occlusion and reverb send
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = opts.vol ?? 1;
    let tail = g;
    if (opts.muffle) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = opts.muffle;
      tail.connect(lp); tail = lp;
    }
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 2; p.rolloffFactor = opts.rolloff ?? 1.1; p.maxDistance = 80;
      if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
      else p.setPosition(pos[0], pos[1], pos[2]);
      tail.connect(p); tail = p;
    }
    tail.connect(this.dry);
    const s = ctx.createGain(); s.gain.value = opts.verb ?? 0.35;
    tail.connect(s); s.connect(this.send);
    return g;
  }
  noise(buf = this.white, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.loopStart = Math.random(); s.loopEnd = s.loopStart + 0.9;
    return s;
  }
  osc(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }
  filt(type, freq, Q = 1) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; return f; }
  env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    return t + a + hold + rel;
  }
  shot(src, dest, t, end) { src.connect(dest); src.start(t); src.stop(end + 0.05); }
  dist(amount = 1) { const w = this.ctx.createWaveShaper(); w.curve = this.distCurve; w.oversample = '2x'; void amount; return w; }

  // burst of filtered noise
  burst(dest, t, { type = 'bandpass', f = 1000, Q = 1, a = 0.002, hold = 0.01, rel = 0.08, vol = 0.5, buf, rate = 1, sweep } = {}) {
    const n = this.noise(buf || this.white, rate);
    const fl = this.filt(type, f, Q);
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + a + hold + rel);
    const g = this.ctx.createGain();
    const end = this.env(g, t, a, vol, hold, rel);
    n.connect(fl); fl.connect(g); g.connect(dest);
    n.start(t); n.stop(end + 0.05);
    return end;
  }
  tone(dest, t, { type = 'sine', f = 440, to, a = 0.005, hold = 0.05, rel = 0.2, vol = 0.3, vib = 0, vibRate = 6, glide } = {}) {
    const o = this.osc(type, f);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + (glide ?? (a + hold + rel)));
    if (vib) {
      const l = this.osc('sine', vibRate), lg = this.ctx.createGain(); lg.gain.value = vib;
      l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + a + hold + rel + 0.1);
    }
    const g = this.ctx.createGain();
    const end = this.env(g, t, a, vol, hold, rel);
    o.connect(g); g.connect(dest); o.start(t); o.stop(end + 0.05);
    return end;
  }

  // ---------- level ambience ----------
  setLevel(level) {
    if (!this.enabled) return;
    this.stopAmbience();
    const A = level.audio, ctx = this.ctx, t = this.now();
    this.buildIR(A.reverb);
    this.verbGain.gain.setTargetAtTime(0.35 + A.reverb * 0.08, t, 0.1);
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(this.dry);
    bus.gain.setTargetAtTime(1, t, 1.5);
    this.ambBus = bus;
    const nodes = [];
    // fluorescent hum: 60Hz family + buzzing 3k ballast
    if (A.hum > 0) {
      const hg = ctx.createGain(); hg.gain.value = 0.05 * A.hum; hg.connect(bus);
      for (const [f, v, ty] of [[60, 0.5, 'sawtooth'], [120, 0.6, 'sine'], [180, 0.25, 'sine'], [240, 0.12, 'triangle']]) {
        const o = this.osc(ty, f), g = ctx.createGain(); g.gain.value = v;
        const lp = this.filt('lowpass', 500); o.connect(lp); lp.connect(g); g.connect(hg); o.start(); nodes.push(o);
      }
      const buzz = this.noise(this.white), bp = this.filt('bandpass', 3200, 6), bg = ctx.createGain(); bg.gain.value = 0.12;
      const am = this.osc('square', 120), amg = ctx.createGain(); amg.gain.value = 0.08;
      am.connect(amg); amg.connect(bg.gain);
      buzz.connect(bp); bp.connect(bg); bg.connect(hg); buzz.start(); am.start(); nodes.push(buzz, am);
      this.humGain = hg; this.humBase = 0.05 * A.hum;
    } else this.humGain = null;
    // drone
    const dg = ctx.createGain(); dg.gain.value = 0.06; dg.connect(bus);
    for (const [m, det] of [[1, 0], [1.5, 3], [2.003, -4], [0.5, 1]]) {
      const o = this.osc('sine', A.drone * m); o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = m === 0.5 ? 0.9 : 0.35;
      o.connect(g); g.connect(dg); o.start(); nodes.push(o);
    }
    const dl = this.osc('sine', 0.07), dlg = ctx.createGain(); dlg.gain.value = 0.03;
    dl.connect(dlg); dlg.connect(dg.gain); dl.start(); nodes.push(dl);
    this.droneGain = dg;
    // room tone / wind
    const rt = this.noise(A.wind > 0.5 ? this.pink : this.brown), rf = this.filt('bandpass', A.wind > 0 ? 500 : 180, 0.6), rg = ctx.createGain();
    rg.gain.value = 0.04 + A.wind * 0.08;
    const wl = this.osc('sine', 0.11), wlg = ctx.createGain(); wlg.gain.value = 250 * A.wind + 30;
    wl.connect(wlg); wlg.connect(rf.frequency);
    rt.connect(rf); rf.connect(rg); rg.connect(bus); rt.start(); wl.start(); nodes.push(rt, wl);
    this.loops = nodes;
    this.level = level;
    // random distant events
    const sched = () => {
      if (!this.enabled || this.level !== level) return;
      this.randomEvent(level);
      this.timers.push(setTimeout(sched, rand(6000, 18000) / Math.max(0.6, level.danger / 2.5)));
    };
    this.timers.push(setTimeout(sched, rand(4000, 9000)));
    if (A.drip > 0) {
      const drip = () => {
        if (!this.enabled || this.level !== level) return;
        this.drip();
        this.timers.push(setTimeout(drip, rand(500, 4000) / A.drip));
      };
      this.timers.push(setTimeout(drip, 1500));
    }
  }

  stopAmbience() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ambBus) {
      const bus = this.ambBus, nodes = this.loops;
      bus.gain.setTargetAtTime(0, this.now(), 0.3);
      setTimeout(() => { for (const n of nodes) try { n.stop(); } catch (e) { /* already stopped */ } bus.disconnect(); }, 1500);
    }
    this.loops = [];
  }

  setListener(pos, fwd) {
    if (!this.enabled) return;
    const L = this.listener, t = this.now();
    this.listenerPos = pos;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos[0], t, 0.02); L.positionY.setTargetAtTime(pos[1], t, 0.02); L.positionZ.setTargetAtTime(pos[2], t, 0.02);
      L.forwardX.setTargetAtTime(fwd[0], t, 0.02); L.forwardY.setTargetAtTime(fwd[1], t, 0.02); L.forwardZ.setTargetAtTime(fwd[2], t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(pos[0], pos[1], pos[2]); L.setOrientation(fwd[0], fwd[1], fwd[2], 0, 1, 0); }
  }

  nearPos(minD = 8, maxD = 25) {
    const p = this.listenerPos || [0, 0, 0];
    const a = Math.random() * Math.PI * 2, d = rand(minD, maxD);
    return [p[0] + Math.cos(a) * d, 1.4, p[2] + Math.sin(a) * d];
  }

  randomEvent(level) {
    const mood = level.audio.mood;
    const pool = ['knock', 'creak', 'steps', 'thud', 'whisper', 'scream', 'radio', 'door'];
    if (mood === 'party') pool.push('laugh', 'laugh');
    if (mood === 'pipes' || mood === 'industrial') pool.push('clang', 'clang', 'steam');
    if (mood === 'electric') pool.push('zap', 'zap');
    if (mood === 'hospital') pool.push('intercom', 'gurney');
    if (mood === 'water' || mood === 'pool') pool.push('splash', 'splash');
    if (mood === 'outside') pool.push('dog', 'wind');
    if (mood === 'alarm') pool.push('alarm');
    this.event(pool[Math.floor(Math.random() * pool.length)], this.nearPos(10, 30));
  }

  event(name, pos) {
    if (!this.enabled) return;
    const t = this.now() + 0.02;
    const o = this.out(pos, { vol: 0.9, verb: 0.8, muffle: 1800, ref: 3 });
    switch (name) {
      case 'knock': for (let i = 0; i < 3; i++) { this.tone(o, t + i * 0.32, { f: 95, to: 60, hold: 0.01, rel: 0.18, vol: 0.9 }); this.burst(o, t + i * 0.32, { f: 400, rel: 0.06, vol: 0.4 }); } break;
      case 'thud': this.tone(o, t, { f: 70, to: 35, hold: 0.02, rel: 0.6, vol: 1 }); this.burst(o, t, { type: 'lowpass', f: 300, rel: 0.4, vol: 0.6 }); break;
      case 'creak': this.tone(o, t, { type: 'sawtooth', f: 90, to: 140, hold: 0.8, rel: 0.6, vol: 0.12, vib: 8, vibRate: 13 }); break;
      case 'steps': for (let i = 0; i < 6; i++) this.step(o, t + i * 0.45, 'concrete', 0.5); break;
      case 'whisper': this.whisper(o, t, 1.6); break;
      case 'scream': this.scream(o, t, 1.4, 0.35); break;
      case 'laugh': this.giggle(o, t, 0.6); break;
      case 'clang': [380, 910, 1530, 2210].forEach((f, i) => this.tone(o, t, { type: 'sine', f, hold: 0.01, rel: 1.6 - i * 0.3, vol: 0.18 })); this.burst(o, t, { f: 2500, rel: 0.05, vol: 0.5 }); break;
      case 'steam': this.burst(o, t, { type: 'highpass', f: 2500, a: 0.1, hold: 1.2, rel: 0.8, vol: 0.25 }); break;
      case 'zap': for (let i = 0; i < 5; i++) this.burst(o, t + i * rand(0.03, 0.09), { type: 'highpass', f: 3000, rel: 0.03, vol: 0.5 }); this.tone(o, t, { type: 'square', f: 60, hold: 0.3, rel: 0.1, vol: 0.08 }); break;
      case 'radio': this.burst(o, t, { f: 1500, Q: 0.5, a: 0.05, hold: 0.8, rel: 0.2, vol: 0.25 }); this.tone(o, t + 0.2, { type: 'square', f: 440, to: 300, hold: 0.3, rel: 0.1, vol: 0.04 }); break;
      case 'door': this.tone(o, t, { type: 'sawtooth', f: 200, to: 320, hold: 0.5, rel: 0.2, vol: 0.06, vib: 20, vibRate: 25 }); this.tone(o, t + 0.75, { f: 80, to: 40, hold: 0.02, rel: 0.5, vol: 1 }); this.burst(o, t + 0.75, { type: 'lowpass', f: 900, rel: 0.25, vol: 0.6 }); break;
      case 'intercom': this.tone(o, t, { f: 880, hold: 0.25, rel: 0.1, vol: 0.12 }); this.tone(o, t + 0.35, { f: 660, hold: 0.35, rel: 0.2, vol: 0.12 }); this.burst(o, t + 0.8, { f: 1200, Q: 3, hold: 1, rel: 0.2, vol: 0.12 }); break;
      case 'gurney': for (let i = 0; i < 8; i++) this.tone(o, t + i * 0.12, { type: 'triangle', f: rand(1800, 2600), hold: 0.02, rel: 0.05, vol: 0.05 }); break;
      case 'splash': this.burst(o, t, { f: 900, Q: 0.8, a: 0.01, hold: 0.05, rel: 0.5, vol: 0.5, sweep: 300 }); break;
      case 'dog': for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.4, { type: 'sawtooth', f: 420, to: 250, hold: 0.02, rel: 0.15, vol: 0.12 }); break;
      case 'wind': this.burst(o, t, { f: 400, Q: 2, a: 1, hold: 1, rel: 2, vol: 0.4, buf: this.pink, sweep: 900 }); break;
      case 'alarm': for (let i = 0; i < 4; i++) this.tone(o, t + i * 0.6, { type: 'square', f: 900, to: 600, hold: 0.3, rel: 0.1, vol: 0.05 }); break;
      default: break;
    }
  }

  drip() {
    const o = this.out(this.nearPos(2, 10), { vol: 0.5, verb: 1.0, ref: 1 });
    const t = this.now(), f = rand(1200, 2600);
    this.tone(o, t, { f, to: f * 0.4, a: 0.001, hold: 0.005, rel: 0.09, vol: 0.4 });
  }

  // ---------- player sounds ----------
  step(dest, t, surface, vol = 1) {
    switch (surface) {
      case 'carpet': this.burst(dest, t, { type: 'lowpass', f: 450, rel: 0.09, vol: 0.5 * vol }); this.tone(dest, t, { f: 70, to: 50, hold: 0.01, rel: 0.06, vol: 0.25 * vol }); break;
      case 'metal': this.burst(dest, t, { type: 'highpass', f: 1800, rel: 0.04, vol: 0.4 * vol }); [420, 980, 1720].forEach((f) => this.tone(dest, t, { f: f * rand(0.97, 1.03), hold: 0.005, rel: 0.25, vol: 0.05 * vol })); this.tone(dest, t, { f: 110, to: 70, hold: 0.01, rel: 0.08, vol: 0.3 * vol }); break;
      case 'tile': this.burst(dest, t, { type: 'highpass', f: 2600, rel: 0.03, vol: 0.45 * vol }); this.tone(dest, t, { f: 140, to: 90, hold: 0.005, rel: 0.05, vol: 0.2 * vol }); break;
      case 'wood': this.burst(dest, t, { f: 700, Q: 1.5, rel: 0.07, vol: 0.5 * vol }); this.tone(dest, t, { f: 120, to: 80, hold: 0.01, rel: 0.09, vol: 0.3 * vol }); if (Math.random() < 0.12) this.tone(dest, t + 0.05, { type: 'sawtooth', f: 160, to: 220, hold: 0.25, rel: 0.1, vol: 0.03 * vol, vib: 10, vibRate: 18 }); break;
      case 'dirt': for (let i = 0; i < 4; i++) this.burst(dest, t + i * 0.012, { f: rand(1200, 3500), Q: 2, rel: 0.03, vol: 0.18 * vol }); this.burst(dest, t, { type: 'lowpass', f: 400, rel: 0.08, vol: 0.3 * vol }); break;
      case 'water': this.burst(dest, t, { f: 1100, Q: 0.7, a: 0.01, hold: 0.06, rel: 0.3, vol: 0.55 * vol, sweep: 450 }); this.tone(dest, t + 0.05, { f: 300, to: 900, hold: 0.02, rel: 0.05, vol: 0.05 * vol }); break;
      default: this.burst(dest, t, { f: 1600, Q: 1, rel: 0.05, vol: 0.45 * vol }); this.tone(dest, t, { f: 110, to: 70, hold: 0.01, rel: 0.07, vol: 0.3 * vol });
    }
  }
  footstep(surface, vol = 1, pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, { vol: 0.55 * vol, verb: 0.25, ref: 2.5 });
    this.step(o, this.now(), surface, 1);
  }
  click() { if (!this.enabled) return; const o = this.out(null, { vol: 0.4, verb: 0.05 }); const t = this.now(); this.burst(o, t, { type: 'highpass', f: 3000, rel: 0.015, vol: 0.7 }); this.tone(o, t, { f: 1800, hold: 0.002, rel: 0.02, vol: 0.2 }); }
  pickup() { if (!this.enabled) return; const o = this.out(null, { vol: 0.35, verb: 0.6 }); const t = this.now(); this.tone(o, t, { f: 660, hold: 0.05, rel: 0.6, vol: 0.2 }); this.tone(o, t + 0.09, { f: 990, hold: 0.05, rel: 0.8, vol: 0.15 }); }
  drink() { if (!this.enabled) return; const o = this.out(null, { vol: 0.5, verb: 0.1 }); const t = this.now(); for (let i = 0; i < 3; i++) { this.burst(o, t + i * 0.32, { type: 'lowpass', f: 600, a: 0.02, hold: 0.05, rel: 0.1, vol: 0.5 }); this.tone(o, t + i * 0.32, { f: 180, to: 120, hold: 0.04, rel: 0.08, vol: 0.2 }); } }
  paper() { if (!this.enabled) return; const o = this.out(null, { vol: 0.5, verb: 0.1 }); const t = this.now(); for (let i = 0; i < 6; i++) this.burst(o, t + i * 0.05, { type: 'highpass', f: rand(2000, 5000), rel: 0.04, vol: 0.25 }); }
  bump() { if (!this.enabled) return; const o = this.out(null, { vol: 0.4, verb: 0.2 }); this.tone(o, this.now(), { f: 90, to: 50, hold: 0.01, rel: 0.12, vol: 0.5 }); }

  transition() {
    if (!this.enabled) return;
    const o = this.out(null, { vol: 0.8, verb: 1 });
    const t = this.now();
    this.burst(o, t, { type: 'bandpass', f: 200, Q: 1, a: 0.6, hold: 0.3, rel: 1.2, vol: 0.6, sweep: 6000 });
    this.tone(o, t, { type: 'sawtooth', f: 40, to: 400, a: 0.5, hold: 0.4, rel: 0.6, vol: 0.12 });
    for (let i = 0; i < 12; i++) this.burst(o, t + 0.8 + i * 0.03, { type: 'highpass', f: 2000, rel: 0.02, vol: 0.3 });
  }

  // breathing + heartbeat react to fear and stamina
  startBodyLoops() {
    let nextBreath = 0, nextBeat = 0, inhale = true;
    this.bodyTick = (dt, s) => {
      if (!this.enabled || !s.alive) return;
      const t = this.now();
      if (t >= nextBreath) {
        const rate = 3.2 - Math.min(2.4, s.exertion * 1.6 + s.fear * 1.4);
        const vol = 0.03 + s.exertion * 0.12 + s.fear * 0.1;
        const o = this.out(null, { vol, verb: 0.05 });
        this.burst(o, t, { type: 'bandpass', f: inhale ? 1100 : 750, Q: 1.2, a: rate * 0.25, hold: rate * 0.05, rel: rate * 0.2, vol: 0.6, buf: this.pink });
        if (s.fear > 0.6 && inhale) this.tone(o, t, { f: 480, to: 520, a: 0.05, hold: 0.1, rel: 0.15, vol: 0.03 * s.fear });
        nextBreath = t + rate * 0.5;
        inhale = !inhale;
      }
      if (s.fear > 0.15 && t >= nextBeat) {
        const bpm = 70 + s.fear * 80 + s.exertion * 30;
        const o = this.out(null, { vol: 0.15 + s.fear * 0.55, verb: 0 });
        this.tone(o, t, { f: 55, to: 38, a: 0.005, hold: 0.02, rel: 0.12, vol: 0.9 });
        this.tone(o, t + 0.16, { f: 48, to: 34, a: 0.005, hold: 0.02, rel: 0.14, vol: 0.6 });
        nextBeat = t + 60 / bpm;
      }
    };
  }

  // ---------- entity voices ----------
  whisper(o, t, dur) {
    for (let i = 0; i < Math.floor(dur * 6); i++) {
      const tt = t + i * rand(0.1, 0.2);
      this.burst(o, tt, { type: 'bandpass', f: rand(1500, 4500), Q: rand(4, 10), a: 0.02, hold: rand(0.02, 0.08), rel: 0.06, vol: 0.35, buf: this.pink });
    }
  }
  giggle(o, t, vol = 0.4) {
    const base = rand(650, 900);
    for (let i = 0; i < 5; i++) this.tone(o, t + i * 0.13, { type: 'triangle', f: base * (1 - i * 0.03), to: base * 0.8, a: 0.01, hold: 0.04, rel: 0.06, vol: vol * 0.3, vib: 40, vibRate: 30 });
  }
  scream(o, t, dur, vol = 0.6) {
    const d = this.dist();
    d.connect(o);
    for (const m of [1, 1.06, 1.5, 2.13]) this.tone(d, t, { type: 'sawtooth', f: 520 * m, to: 380 * m, a: 0.03, hold: dur * 0.6, rel: dur * 0.4, vol: vol * 0.12, vib: 30 * m, vibRate: 11 });
    this.burst(d, t, { type: 'bandpass', f: 2500, Q: 1, a: 0.02, hold: dur * 0.6, rel: dur * 0.4, vol: vol * 0.4 });
  }
  growl(o, t, dur, f = 70, vol = 0.6) {
    const d = this.dist(); d.connect(o);
    const lp = this.filt('lowpass', 700); lp.connect(d);
    this.tone(lp, t, { type: 'sawtooth', f, to: f * 0.8, a: 0.08, hold: dur, rel: 0.3, vol: vol * 0.5, vib: f * 0.3, vibRate: 23 });
    this.burst(lp, t, { type: 'lowpass', f: 500, a: 0.1, hold: dur, rel: 0.3, vol: vol * 0.6, buf: this.brown });
  }
  clicks(o, t, n = 12, f = 3500) { for (let i = 0; i < n; i++) this.burst(o, t + i * rand(0.04, 0.09), { f: f * rand(0.7, 1.3), Q: 6, rel: 0.012, vol: 0.5 }); }

  voice(type, pos, kind = 'idle', occluded = false) {
    if (!this.enabled) return;
    const o = this.out(pos, { vol: kind === 'alert' ? 1.0 : 0.7, verb: 0.5, muffle: occluded ? 900 : 0, ref: 2.5 });
    const t = this.now() + 0.01;
    const alert = kind === 'alert';
    switch (type) {
      case 'smiler': alert ? this.growl(o, t, 1.2, 50, 0.8) : this.burst(o, t, { type: 'bandpass', f: 300, Q: 3, a: 0.5, hold: 0.6, rel: 0.6, vol: 0.4, buf: this.pink }); if (alert) this.giggle(o, t + 0.4, 0.3); break;
      case 'hound': alert ? (this.growl(o, t, 0.5, 90, 0.9), this.scream(o, t + 0.45, 0.6, 0.5)) : this.growl(o, t, 1.2, 65, 0.5); break;
      case 'howler': this.tone(o, t, { f: alert ? 330 : 260, to: alert ? 700 : 420, a: 0.3, hold: 0.8, rel: 1.0, vol: 0.25, vib: 18, vibRate: 5 }); this.burst(o, t, { f: 900, Q: 4, a: 0.3, hold: 0.8, rel: 1, vol: 0.1, buf: this.pink }); break;
      case 'partygoer': this.giggle(o, t, alert ? 0.8 : 0.45); if (alert) this.giggle(o, t + 0.7, 0.8); break;
      case 'skinstealer': if (alert) this.scream(o, t, 1.0, 0.7); else { const f = this.filt('bandpass', 750, 6); f.connect(o); this.tone(f, t, { type: 'sawtooth', f: 115, to: 100, a: 0.2, hold: 0.6, rel: 0.4, vol: 0.6, vib: 3 }); } break;
      case 'faceling': { const f = this.filt('lowpass', 400); f.connect(o); this.tone(f, t, { f: 170, a: 0.3, hold: 0.7, rel: 0.4, vol: 0.25, vib: 4 }); break; }
      case 'clump': this.burst(o, t, { type: 'lowpass', f: 600, a: 0.1, hold: 0.8, rel: 0.3, vol: 0.5, buf: this.brown }); this.clicks(o, t, alert ? 18 : 8, 900); break;
      case 'deathmoth': { const n = this.noise(this.pink), g = this.ctx.createGain(), am = this.osc('square', 26), amg = this.ctx.createGain(); amg.gain.value = 0.3; g.gain.value = 0.3; am.connect(amg); amg.connect(g.gain); n.connect(g); g.connect(o); n.start(t); am.start(t); n.stop(t + 1.2); am.stop(t + 1.2); if (alert) this.clicks(o, t, 10, 5000); break; }
      case 'wretch': this.burst(o, t, { type: 'bandpass', f: 600, Q: 2, a: 0.4, hold: 0.3, rel: 0.5, vol: 0.4, buf: this.pink }); if (alert) this.growl(o, t + 0.3, 0.6, 120, 0.6); break;
      case 'pale': this.whisper(o, t, alert ? 1.4 : 0.9); break;
      case 'crawler': this.clicks(o, t, alert ? 24 : 10, 2800); break;
      case 'shadow': this.whisper(o, t, 1.0); if (alert) this.burst(o, t, { f: 120, Q: 1, a: 0.3, hold: 0.4, rel: 0.6, vol: 0.4, buf: this.brown }); break;
      case 'hollow': for (let i = 0; i < (alert ? 6 : 3); i++) this.burst(o, t + i * 0.2, { f: 1400, Q: 5, rel: 0.03, vol: 0.6 }); break;
      case 'screamer': this.scream(o, t, alert ? 1.3 : 0.6, alert ? 0.9 : 0.4); break;
      default: this.growl(o, t, 0.8);
    }
  }

  // continuous dragging/stepping for a moving entity (call periodically)
  entityStep(type, pos, occluded) {
    if (!this.enabled) return;
    const o = this.out(pos, { vol: 0.6, verb: 0.3, muffle: occluded ? 800 : 0, ref: 2 });
    const t = this.now();
    if (type === 'clump') this.burst(o, t, { type: 'lowpass', f: 300, a: 0.05, hold: 0.1, rel: 0.2, vol: 0.5, buf: this.brown });
    else if (type === 'deathmoth') this.burst(o, t, { f: 300, Q: 1, a: 0.02, hold: 0.05, rel: 0.1, vol: 0.2, buf: this.pink });
    else if (type === 'hound' || type === 'crawler') { this.burst(o, t, { f: 900, Q: 1, rel: 0.04, vol: 0.4 }); this.burst(o, t + 0.07, { f: 700, Q: 1, rel: 0.04, vol: 0.3 }); }
    else if (type === 'smiler' || type === 'shadow' || type === 'screamer') { /* silent movers */ }
    else this.step(o, t, 'concrete', 0.9);
  }

  // ---------- adrenaline layers ----------
  setChase(intensity) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    if (!this.chaseBus) {
      const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(this.master);
      const lp = this.filt('lowpass', 400); lp.connect(bus);
      // dissonant cluster
      for (const f of [55, 58.3, 82.4, 87.3, 110]) { const o = this.osc('sawtooth', f), g = ctx.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(lp); o.start(); }
      // pulse
      const pulse = this.osc('sine', 42), pg = ctx.createGain(); pg.gain.value = 0;
      const lfo = this.osc('square', 2.4), lg = ctx.createGain(); lg.gain.value = 0.25;
      lfo.connect(lg); lg.connect(pg.gain); pulse.connect(pg); pg.connect(bus); pulse.start(); lfo.start();
      // high string screech
      const hs = this.osc('sawtooth', 1870), hsf = this.filt('bandpass', 1900, 8), hg = ctx.createGain(); hg.gain.value = 0.02;
      const v = this.osc('sine', 7), vg = ctx.createGain(); vg.gain.value = 25; v.connect(vg); vg.connect(hs.frequency);
      hs.connect(hsf); hsf.connect(hg); hg.connect(bus); hs.start(); v.start();
      this.chaseBus = bus; this.chaseLP = lp;
    }
    this.chaseBus.gain.setTargetAtTime(intensity * 0.9, t, intensity > this.chase ? 0.2 : 1.2);
    this.chaseLP.frequency.setTargetAtTime(300 + intensity * 2500, t, 0.3);
    this.chase = intensity;
  }

  setHum(level) { if (this.humGain) this.humGain.gain.setTargetAtTime(this.humBase * level, this.now(), 0.08); }

  stinger() {
    if (!this.enabled) return;
    const o = this.out(null, { vol: 0.8, verb: 0.6 });
    const t = this.now();
    for (const f of [220, 233, 311, 330]) this.tone(o, t, { type: 'sawtooth', f, a: 0.01, hold: 0.2, rel: 1.2, vol: 0.07, vib: 6 });
    this.tone(o, t, { f: 60, to: 30, hold: 0.1, rel: 1.2, vol: 0.6 });
  }

  jumpscare(type) {
    if (!this.enabled) return;
    const o = this.out(null, { vol: 1.3, verb: 0.4 });
    const t = this.now();
    const d = this.dist(); d.connect(o);
    this.burst(d, t, { type: 'bandpass', f: 1800, Q: 0.5, a: 0.005, hold: 0.6, rel: 0.6, vol: 1 });
    for (const f of [311, 330, 466, 494, 698, 740]) this.tone(d, t, { type: 'sawtooth', f, to: f * 0.85, a: 0.005, hold: 0.7, rel: 0.5, vol: 0.1, vib: 25, vibRate: 13 });
    this.tone(o, t, { f: 80, to: 25, a: 0.002, hold: 0.2, rel: 1.2, vol: 1.0 });
    this.voice(type, null, 'alert');
  }

  update(dt, s) {
    if (!this.enabled) return;
    this.bodyTick && this.bodyTick(dt, s);
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
