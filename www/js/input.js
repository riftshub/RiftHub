// Keyboard + mouse (pointer lock) and touch controls (virtual joystick, look-drag, buttons).
export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered actions this frame
    this.look = [0, 0];
    this.move = [0, 0];
    this.sens = 1;
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.sprintToggle = false;
    this.crouchToggle = false;
    this.locked = false;
    this.enabled = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { KeyF: 'flash', KeyE: 'use', KeyQ: 'drink', Escape: 'pause', KeyC: 'crouch', Tab: 'players' };
      if (map[e.code]) { this.pressed.add(map[e.code]); if (e.code === 'Tab') e.preventDefault(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.look[0] += e.movementX * 0.0022 * this.sens;
      this.look[1] += e.movementY * 0.0022 * this.sens;
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (!this.locked) this.lock();
      else if (e.button === 0) this.pressed.add('flash');
      else if (e.button === 2) this.pressed.add('use');
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.enabled && !this.touch) this.pressed.add('unlock');
    });
    if (this.touch) this.setupTouch(ui);
  }

  lock() { if (!this.touch && this.canvas.requestPointerLock) { try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  setupTouch(ui) {
    const stick = ui.stick, knob = ui.knob;
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 60;
    const zone = ui.touchZone;
    zone.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.target.closest('.tbtn')) continue;
        if (t.clientX < innerWidth * 0.42 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = sx - R + 'px'; stick.style.top = sy - R + 'px'; stick.style.opacity = 1;
          knob.style.transform = 'translate(0px,0px)';
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.move = [dx / R, -dy / R];
          this.sprintStick = d > R * 0.95 && dy < -R * 0.7;
        } else if (t.identifier === lookId) {
          this.look[0] += (t.clientX - lx) * 0.0055 * this.sens;
          this.look[1] += (t.clientY - ly) * 0.0055 * this.sens;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.move = [0, 0]; this.sprintStick = false; stick.style.opacity = 0.35; knob.style.transform = 'translate(0px,0px)'; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
    const btn = (el, action, hold) => {
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (hold) { this[hold] = !this[hold]; el.classList.toggle('on', this[hold]); }
        else this.pressed.add(action);
      }, { passive: false });
    };
    btn(ui.bFlash, 'flash'); btn(ui.bUse, 'use'); btn(ui.bDrink, 'drink'); btn(ui.bPause, 'pause');
    btn(ui.bSprint, null, 'sprintToggle'); btn(ui.bCrouch, null, 'crouchToggle');
  }

  state() {
    const k = this.keys;
    let mx = this.move[0], my = this.move[1];
    if (!this.touch || (mx === 0 && my === 0)) {
      mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.sprintToggle || this.sprintStick;
    const crouch = k.has('ControlLeft') || this.crouchToggle;
    const s = { mx, my, sprint, crouch, look: this.look.slice(), pressed: new Set(this.pressed) };
    this.look[0] = 0; this.look[1] = 0;
    this.pressed.clear();
    return s;
  }
}
