'use strict';
// Клавиатура + мышь → тот же формат input, что у бота.
class PlayerController {
  constructor(game, el) {
    this.game = game;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: innerWidth * 0.6, y: innerHeight * 0.4, l: false, r: false };
    game.pointer = this.mouse;

    addEventListener('keydown', e => {
      const a = this.map(e.code);
      if (!a) return;
      if (game.mode === 'bot') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(a); this.pressed.add(a);
    });
    addEventListener('keyup', e => { const a = this.map(e.code); if (a) this.keys.delete(a); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    el.addEventListener('pointerdown', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 0) this.mouse.l = true;
      if (e.button === 2) { this.mouse.r = true; this.pressed.add('push'); }
    });
    addEventListener('pointerup', e => {
      if (e.button === 0) this.mouse.l = false;
      if (e.button === 2) this.mouse.r = false;
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  map(code) {
    switch (code) {
      case 'KeyA': case 'ArrowLeft': return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      case 'KeyW': case 'ArrowUp': case 'Space': return 'jump';
      case 'KeyS': case 'ArrowDown': return 'down';
      case 'ShiftLeft': case 'ShiftRight': return 'dash';
      case 'KeyE': return 'push';
    }
    return null;
  }

  reset() { this.pressed.clear(); this.mouse.l = false; }

  consume(a) {
    if (this.pressed.has(a)) { this.pressed.delete(a); return true; }
    return false;
  }

  getInput(f, opp, game) {
    const w = game.renderer.screenToWorld(this.mouse.x, this.mouse.y);
    const s = f.shoulder;
    return {
      move: (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0),
      jump: this.consume('jump'),
      down: this.keys.has('down'),
      dash: this.consume('dash'),
      push: this.consume('push'),
      power: this.mouse.l,
      aim: Math.atan2(w.y - s.y, w.x - s.x),
    };
  }
}
