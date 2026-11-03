'use strict';
// Искры, дым, волны, тексты. Только визуал — на логику боя не влияет.
class Effects {
  constructor(game) { this.game = game; this.clear(); }

  clear() { this.parts = []; this.rings = []; this.texts = []; this.ghosts = []; this.flashes = []; }

  add(p) { p.max = p.life; if (this.parts.length < 900) this.parts.push(p); }

  sparks(x, y, n, speed, colors, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rand(-o.spread, o.spread) : rand(0, TAU);
      const s = speed * rand(0.25, 1);
      this.add({
        type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.15, 0.45) * (o.life || 1), color: colors[(Math.random() * colors.length) | 0],
        size: rand(1, 2.6) * (o.size || 1), g: o.g ?? 1400, drag: 2.5,
      });
    }
  }

  clash(p, inten, colors) {
    this.sparks(p.x, p.y, Math.round(10 + 30 * inten), 300 + 700 * inten, colors);
    this.flashes.push({ x: p.x, y: p.y, r: 40 + 80 * inten, life: 0.12, max: 0.12 });
  }

  hit(p, rgb, nx, ny, dmg) {
    const dir = Math.atan2(ny, nx);
    const cols = ['#ffb347', '#ff7b2e', '#fff1c1', rgba(rgb, 1)];
    this.sparks(p.x, p.y, Math.round(8 + dmg * 0.6), 500 + dmg * 12, cols, { dir, spread: 0.7 });
    for (let i = 0; i < 6; i++) {
      this.add({ type: 'ember', x: p.x, y: p.y, vx: rand(-80, 80) + nx * 120, vy: rand(-160, -20), life: rand(0.5, 1.1), color: cols[i % 3], size: rand(1.2, 2.4), g: 300, drag: 1.5 });
    }
    for (let i = 0; i < 3; i++) this.smoke(p.x, p.y);
    this.flashes.push({ x: p.x, y: p.y, r: 30 + dmg, life: 0.1, max: 0.1 });
  }

  smoke(x, y) {
    this.add({ type: 'smoke', x: x + rand(-4, 4), y, vx: rand(-20, 20), vy: -rand(30, 70), life: rand(0.6, 1.0), size: rand(5, 10), g: -20, drag: 1 });
  }

  dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      const d = i % 2 ? 1 : -1;
      this.add({ type: 'dust', x, y: y - 2, vx: d * rand(60, 220), vy: -rand(10, 60), life: rand(0.3, 0.6), size: rand(3, 7), g: 200, drag: 4 });
    }
  }

  ring(x, y, r0, r1, life, rgb, width = 2) {
    this.rings.push({ x, y, r0, r1, life, max: life, rgb, width });
  }

  wave(f) {
    const s = f.shoulder, hx = s.x + f.facing * 26, hy = s.y + 4;
    this.ring(hx, hy, 10, 160, 0.35, { r: 200, g: 225, b: 255 }, 3);
    for (let i = 0; i < 22; i++) {
      const a = mirrorAngle(rand(-0.4, 0.4), f.facing);
      const sp = rand(500, 1100);
      this.add({ type: 'wisp', x: hx, y: hy + rand(-30, 30), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.4), color: 'rgba(200,225,255,1)', size: rand(1.5, 3), g: 0, drag: 3 });
    }
  }

  ghost(f) {
    this.ghosts.push({ x: f.x, y: f.y, lean: f.lean, rgb: f.rgb, life: 0.22, max: 0.22 });
  }

  text(x, y, str, color, size = 20, life = 0.9) {
    this.texts.push({ x, y, str, color, size, life, max: life });
  }

  update(dt) {
    for (const p of this.parts) {
      p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
    }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const arr of [this.rings, this.ghosts, this.flashes]) for (const r of arr) r.life -= dt;
    for (const t of this.texts) { t.life -= dt; t.y -= 40 * dt; }
    this.rings = this.rings.filter(r => r.life > 0);
    this.ghosts = this.ghosts.filter(r => r.life > 0);
    this.flashes = this.flashes.filter(r => r.life > 0);
    this.texts = this.texts.filter(r => r.life > 0);
  }
}
