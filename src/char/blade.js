'use strict';
// Энергоклинок со шлейфом взмаха.
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0 }, o));

// ---------- Клинок ----------
class Blade {
  constructor(color, scene) {
    this.group = new THREE.Group();
    const metal = mat(0x9aa0b8, { metalness: 0.85, roughness: 0.3 });
    const dark = mat(0x23263a, { metalness: 0.6, roughness: 0.5 });
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.26, 12), metal);
    hilt.position.y = 0.05;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 12), dark);
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 0.05, 12), metal);
    emitter.position.y = 0.19;
    this.group.add(hilt, grip, emitter);
    const mk = (r, color, opacity) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 12, 1);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: opacity >= 1 }));
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
  }
  setIgnite(k) {
    const len = CFG.BLADE_LEN * Math.max(0.001, k);
    for (const m of [this.core, this.glow, this.halo]) { m.scale.y = len; m.visible = k > 0.01; }
    this.light.intensity = 0.9 * k;
    this.light.position.y = 0.2 + len * 0.5;
    this.ignite = k;
  }
  orient(h, d) {
    this.group.position.set(h[0], h[1], h[2]);
    _v1.set(d[0], d[1], d[2]);
    this.group.quaternion.setFromUnitVectors(UP, _v1);
  }
  sampleTrail(speed) {
    if (this.ignite < 0.3) { this.trail.reset(); return; }
    this.group.updateMatrixWorld(true);
    const base = new THREE.Vector3(0, 0.25, 0).applyMatrix4(this.group.matrixWorld);
    const tip = new THREE.Vector3(0, 0.21 + CFG.BLADE_LEN * this.ignite, 0).applyMatrix4(this.group.matrixWorld);
    this.trail.push(base, tip, clamp((speed - 3) / 10, 0, 1));
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
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
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

