'use strict';
// Два режима мыши:
//  • свободный (по умолчанию): мышь крутит камеру, а сторону удара выбирает резкое движение мыши;
//  • фиксация на цели (Q или колесо): камера сама держит противника, мышь ведёт курсор внутри креста.
// Сектора креста в экранных градусах (y вниз): верх, право, низ-право, низ-лево, лево.
function stanceFromVec(x, y) {
  const a = Math.atan2(y, x) * 180 / Math.PI;
  if (a >= -45 && a < 30) return DIR.RIGHT;
  if (a >= 30 && a < 90) return DIR.DOWN_RIGHT;
  if (a >= 90 && a < 150) return DIR.DOWN_LEFT;
  if (a >= -135 && a < -45) return DIR.UP;
  return DIR.LEFT;
}

class PlayerController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.rmb = false;
    this.vec = { x: 0, y: 0 };
    this.stance = DIR.RIGHT;
    this.lockOn = false;
    this.thirdPerson = false;
    this.yaw = 0; this.pitch = 0;
    this.sensLook = 0.0024;
    this.onStance = null;
    this.onToggle = null;

    addEventListener('keydown', e => {
      const a = this.map(e.code);
      if (!a) return;
      if (document.body.classList.contains('playing')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(a); this.pressed.add(a);
      if (a === 'lock') this.toggleLock();
      if (a === 'camera') { this.thirdPerson = !this.thirdPerson; if (this.onToggle) this.onToggle(this.thirdPerson ? 'Вид от третьего лица' : 'Вид от первого лица'); }
    });
    addEventListener('keyup', e => { const a = this.map(e.code); if (a) this.keys.delete(a); });
    addEventListener('blur', () => { this.keys.clear(); this.rmb = false; });
    addEventListener('mousemove', e => this.onMove(e.movementX || 0, e.movementY || 0));
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.pressed.add('attack');
      if (e.button === 1) { e.preventDefault(); this.toggleLock(); }
      if (e.button === 2) { this.rmb = true; this.pressed.add('feint'); }
    });
    addEventListener('mouseup', e => { if (e.button === 2) this.rmb = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  toggleLock() {
    this.lockOn = !this.lockOn;
    this.vec.x = this.vec.y = 0;
    if (this.onToggle) this.onToggle(this.lockOn ? 'Цель захвачена' : 'Свободный обзор');
  }

  map(code) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': return 'fwd';
      case 'KeyS': case 'ArrowDown': return 'back';
      case 'KeyA': case 'ArrowLeft': return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      case 'Space': return 'jump';
      case 'ShiftLeft': case 'ShiftRight': return 'dodge';
      case 'KeyF': return 'clinch';
      case 'KeyQ': return 'lock';
      case 'KeyV': return 'camera';
    }
    return null;
  }

  setStance(s) { if (s !== this.stance) { this.stance = s; if (this.onStance) this.onStance(s); } }

  onMove(dx, dy) {
    if (!document.body.classList.contains('playing')) return;
    if (this.lockOn) {
      // Курсор внутри креста
      this.vec.x += dx * 0.006; this.vec.y += dy * 0.006;
      const l = Math.hypot(this.vec.x, this.vec.y);
      if (l > 1) { this.vec.x /= l; this.vec.y /= l; }
      if (l > 0.35) this.setStance(stanceFromVec(this.vec.x, this.vec.y));
    } else {
      // Обзор + резкий рывок мыши выбирает сторону
      this.yaw -= dx * this.sensLook;
      this.pitch = clamp(this.pitch - dy * this.sensLook, -1.3, 1.3);
      this.vec.x += dx * 0.0045; this.vec.y += dy * 0.0045;
      const l = Math.hypot(this.vec.x, this.vec.y);
      if (l > 1) { this.vec.x /= l; this.vec.y /= l; }
      if (l > 0.55) this.setStance(stanceFromVec(this.vec.x, this.vec.y));
    }
  }

  reset() { this.pressed.clear(); this.rmb = false; this.vec.x = this.vec.y = 0; }

  consume(a) { if (this.pressed.has(a)) { this.pressed.delete(a); return true; } return false; }

  getInput(me, opp, game, dt) {
    if (this.lockOn) this.yaw = me.yaw;
    else { const k = Math.exp(-6 * dt); this.vec.x *= k; this.vec.y *= k; } // рывок «остывает»
    const atk = this.consume('attack');
    return {
      mz: (this.keys.has('fwd') ? 1 : 0) - (this.keys.has('back') ? 1 : 0),
      mx: (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0),
      stance: this.stance,
      attack: atk, mash: atk,
      block: this.rmb,
      feint: this.consume('feint'),
      dodge: this.consume('dodge'),
      jump: this.consume('jump'),
      jumpHeld: this.keys.has('jump'),
      clinch: this.consume('clinch'),
      lock: this.lockOn,
      yaw: this.lockOn ? null : this.yaw,
    };
  }
}
