'use strict';
// Энергоклинок со шлейфом взмаха.
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0 }, o));

// ---------- Клинок ----------
class Blade {
  constructor(color, scene) {
    this.group = new THREE.Group();
    const metal = mat(0xa7adc2, { metalness: 0.9, roughness: 0.28 });
    const dark = mat(0x1d2030, { metalness: 0.3, roughness: 0.75 });
    // Корпус рукояти — тело вращения: навершие, шейка, рукоять, раструб эмиттера
    const prof = [
      [0, -0.088], [0.02, -0.088], [0.026, -0.083], [0.027, -0.074], [0.022, -0.068], [0.022, -0.062],
      [0.0235, -0.06], [0.0235, 0.062], [0.021, 0.066], [0.021, 0.1], [0.024, 0.104], [0.024, 0.12],
      [0.027, 0.124], [0.031, 0.178], [0.033, 0.192], [0.033, 0.202], [0.027, 0.206], [0.024, 0.198], [0, 0.198],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), metal);
    this.group.add(body);
    // Резиновые кольца хвата
    for (let i = 0; i < 7; i++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0262, 0.0262, 0.008, 16), dark);
      ring.position.y = -0.048 + i * 0.016;
      this.group.add(ring);
    }
    // Кнопка активации на коробке
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.03, 0.016), dark);
    box.position.set(0.024, 0.088, 0);
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.button.rotation.z = Math.PI / 2;
    this.button.position.set(0.032, 0.092, 0);
    // Сопло эмиттера: тёмное внутри, по краю светится цветом клинка
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18), dark);
    nozzle.rotation.x = -Math.PI / 2; nozzle.position.y = 0.199;
    this.emitRing = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.02, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }));
    this.emitRing.rotation.x = -Math.PI / 2; this.emitRing.position.y = 0.2;
    this.group.add(box, this.button, nozzle, this.emitRing);
    const mk = (r, color, opacity) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 12, 1);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: opacity >= 1, toneMapped: false }));
      m.position.y = 0.21;
      this.group.add(m);
      return m;
    };
    this.core = mk(0.011, 0xffffff, 1);
    this.glow = mk(0.026, 0xffffff, 0.6);
    this.halo = mk(0.06, 0xffffff, 0.16);
    this.light = new THREE.PointLight(0xffffff, 1.4, 5, 2);
    this.light.position.y = 0.7;
    this.group.add(this.light);
    this.trail = new Trail(scene);
    this.setColor(color);
    this.setIgnite(1);
  }
  setColor(hex) {
    const c = new THREE.Color(hex);
    this.glow.material.color.copy(c);
    this.halo.material.color.copy(c);
    this.light.color.copy(c);
    this.trail.setColor(c);
    this.button.material.color.copy(c).lerp(new THREE.Color(0xffffff), 0.3);
    this.emitRing.material.color.copy(c);
  }
  setIgnite(k) {
    const len = CFG.BLADE_LEN * Math.max(0.001, k);
    for (const m of [this.core, this.glow, this.halo]) { m.scale.y = len; m.visible = k > 0.01; }
    this.light.intensity = 0.9 * k;
    this.emitRing.material.opacity = 0.15 + 0.75 * k;
    this.light.position.y = 0.2 + len * 0.5;
    this.ignite = k;
  }
  orient(h, d) {
    this.group.position.set(h[0], h[1], h[2]);
    _v1.set(d[0], d[1], d[2]);
    this.group.quaternion.setFromUnitVectors(UP, _v1);
  }
  // След: яркость по реальной скорости кончика лезвия (а не только по скорости позы руки) —
  // так след есть у обратного хвата, вращений, отбивов и всего, что крутит клинок поверх позы
  sampleTrail(speed, dt = 1 / 60) {
    if (this.ignite < 0.3) { this.trail.reset(); this.prevTip = null; return; }
    this.group.updateMatrixWorld(true);
    const base = new THREE.Vector3(0, 0.25, 0).applyMatrix4(this.group.matrixWorld);
    const tip = new THREE.Vector3(0, 0.21 + CFG.BLADE_LEN * this.ignite, 0).applyMatrix4(this.group.matrixWorld);
    let tipK = 0;
    if (this.prevTip && dt > 0) { const v = tip.distanceTo(this.prevTip) / dt; tipK = clamp((v - 3) / 9, 0, 1); }
    this.prevTip = tip.clone();
    this.trail.push(base, tip, Math.max(clamp((speed - 3) / 10, 0, 1), tipK));
  }
  dispose(scene) { scene.remove(this.trail.mesh); }
}

class Trail {
  constructor(scene, n = 14) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 6);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.samples = [];
    this.c = new THREE.Color();
  }
  setColor(c) { this.c.copy(c); }
  reset() { this.samples = []; this.mesh.visible = false; }
  push(base, tip, strength) {
    this.samples.unshift({ b: base, t: tip, s: strength });
    if (this.samples.length > this.n) this.samples.pop();
    const s = this.samples;
    this.mesh.visible = s.length > 1;
    for (let i = 0; i < this.n; i++) {
      const p = s[Math.min(i, s.length - 1)], o = i * 6;
      this.pos[o] = p.b.x; this.pos[o + 1] = p.b.y; this.pos[o + 2] = p.b.z;
      this.pos[o + 3] = p.t.x; this.pos[o + 4] = p.t.y; this.pos[o + 5] = p.t.z;
      const a = (1 - i / this.n) * p.s * 0.55;
      this.col[o] = this.c.r * a * 0.3; this.col[o + 1] = this.c.g * a * 0.3; this.col[o + 2] = this.c.b * a * 0.3;
      this.col[o + 3] = this.c.r * a; this.col[o + 4] = this.c.g * a; this.col[o + 5] = this.c.b * a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

