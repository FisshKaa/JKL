'use strict';
// Мышь в режиме захвата цели не крутит камеру, а двигает «курсор» внутри звезды:
// куда увёл мышь, та сторона и выбрана (как в Kingdom Come).
class PlayerController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.rmb = false;
    this.vec = { x: 0.8, y: 0 };
    this.stance = DIR.RIGHT;
    this.lockOn = true;
    this.yaw = 0; this.pitch = 0;
    this.sens = 0.006;
    this.onStance = null;

    addEventListener('keydown', e => {
      const a = this.map(e.code);
      if (!a) return;
      if (document.body.classList.contains('playing')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(a); this.pressed.add(a);
      if (a === 'lock') this.lockOn = !this.lockOn;
    });
    addEventListener('keyup', e => { const a = this.map(e.code); if (a) this.keys.delete(a); });
    addEventListener('blur', () => { this.keys.clear(); this.rmb = false; });
    addEventListener('mousemove', e => this.onMove(e.movementX || 0, e.movementY || 0));
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.pressed.add('attack');
      if (e.button === 2) { this.rmb = true; this.pressed.add('feint'); }
    });
    addEventListener('mouseup', e => { if (e.button === 2) this.rmb = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  map(code) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': return 'fwd';
      case 'KeyS': case 'ArrowDown': return 'back';
      case 'KeyA': case 'ArrowLeft': return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      case 'Space': return 'dodge';
      case 'KeyF': return 'clinch';
      case 'KeyQ': case 'Tab': return 'lock';
    }
    return null;
  }

  onMove(dx, dy) {
    if (!document.body.classList.contains('playing')) return;
    if (this.lockOn) {
      this.vec.x += dx * this.sens; this.vec.y += dy * this.sens;
      const l = Math.hypot(this.vec.x, this.vec.y);
      if (l > 1) { this.vec.x /= l; this.vec.y /= l; }
      if (l > 0.35) {
        const a = Math.atan2(this.vec.y, this.vec.x); // экранные координаты: y вниз
        let s;
        if (a > -Math.PI / 4 && a <= Math.PI / 4) s = DIR.RIGHT;
        else if (a > Math.PI / 4 && a <= 3 * Math.PI / 4) s = DIR.DOWN;
        else if (a <= -Math.PI / 4 && a > -3 * Math.PI / 4) s = DIR.UP;
        else s = DIR.LEFT;
        if (s !== this.stance) { this.stance = s; if (this.onStance) this.onStance(s); }
      }
    } else {
      this.yaw -= dx * 0.0024;
      this.pitch = clamp(this.pitch - dy * 0.0024, -1.2, 1.2);
    }
  }

  reset() { this.pressed.clear(); this.rmb = false; }

  consume(a) { if (this.pressed.has(a)) { this.pressed.delete(a); return true; } return false; }

  getInput(me) {
    if (this.lockOn) this.yaw = me.yaw;
    const atk = this.consume('attack');
    return {
      mz: (this.keys.has('fwd') ? 1 : 0) - (this.keys.has('back') ? 1 : 0),
      mx: (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0),
      stance: this.stance,
      attack: atk,
      mash: atk,
      block: this.rmb,
      feint: this.consume('feint'),
      dodge: this.consume('dodge'),
      clinch: this.consume('clinch'),
      lock: this.lockOn,
      yaw: this.lockOn ? null : this.yaw,
    };
  }
}
