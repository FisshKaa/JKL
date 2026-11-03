'use strict';
// Искры столкновений и попаданий + вспышка света в точке контакта.
class Effects3D {
  constructor(scene) {
    this.N = 800;
    this.pos = new Float32Array(this.N * 3);
    this.col = new Float32Array(this.N * 3);
    this.p = [];
    for (let i = 0; i < this.N; i++) { this.p.push({ life: 0 }); this.pos[i * 3 + 1] = -999; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const dg = dot.getContext('2d'), gr = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = gr; dg.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.03, map: new THREE.CanvasTexture(dot), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.flash = new THREE.PointLight(0xffffff, 0, 7, 2);
    scene.add(this.flash);
    this.flashT = 0; this.flashMax = 1;
    this.next = 0;
    this.white = new THREE.Color(0xffffff);
    this.warm = new THREE.Color(0xffd27a);
    this.fire = new THREE.Color(0xff7b2e);
  }

  emit(p, n, speed, colors, life = 0.5, grav = -7) {
    for (let k = 0; k < n; k++) {
      const q = this.p[this.next];
      this.next = (this.next + 1) % this.N;
      const th = rand(0, TAU), ph = Math.acos(rand(-1, 1)), s = speed * rand(0.25, 1);
      Object.assign(q, {
        x: p.x, y: p.y, z: p.z,
        vx: Math.sin(ph) * Math.cos(th) * s, vy: Math.cos(ph) * s * 0.8 + speed * 0.2, vz: Math.sin(ph) * Math.sin(th) * s,
        life: life * rand(0.4, 1), max: life, c: colors[randInt(colors.length)], g: grav,
      });
    }
  }

  light(p, color, intensity, dur) {
    this.flash.position.set(p.x, p.y, p.z);
    this.flash.color.set(color);
    this.flashMax = intensity; this.flashT = dur; this.flashDur = dur;
  }

  clash(p, inten, ca, cb) {
    const cols = [this.white, this.warm, new THREE.Color(ca), new THREE.Color(cb)];
    this.emit(p, Math.round(25 + 50 * inten), 2.5 + 4 * inten, cols, 0.55);
    this.light(p, 0xfff2d0, 6 * inten + 2, 0.15);
  }

  sparks(p, n, ca, cb) {
    this.emit(p, n, 1.6, [this.white, this.warm, new THREE.Color(ca), new THREE.Color(cb)], 0.35);
  }

  hit(p, color, dmg) {
    this.emit(p, Math.round(30 + dmg), 3.2, [this.fire, this.warm, new THREE.Color(color)], 0.7, -5);
    this.light(p, 0xff8a40, 5, 0.18);
  }

  update(dt) {
    for (let i = 0; i < this.N; i++) {
      const q = this.p[i], o = i * 3;
      if (q.life <= 0) { this.pos[o + 1] = -999; continue; }
      q.life -= dt;
      q.vx *= 1 - 2.2 * dt; q.vz *= 1 - 2.2 * dt; q.vy += q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.01) { q.y = 0.01; q.vy *= -0.3; }
      const a = Math.max(0, q.life / q.max);
      this.pos[o] = q.x; this.pos[o + 1] = q.y; this.pos[o + 2] = q.z;
      this.col[o] = q.c.r * a; this.col[o + 1] = q.c.g * a; this.col[o + 2] = q.c.b * a;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = this.flashMax * Math.max(0, this.flashT / this.flashDur); }
    else this.flash.intensity = 0;
  }
}
