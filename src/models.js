'use strict';
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function limbMesh(r, mat) {
  const g = new THREE.CylinderGeometry(r, r * 0.9, 1, 10);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
// Растягивает цилиндр высотой 1 между точками a и b
function setLimb(m, a, b) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  _v3.copy(b).sub(a);
  const len = _v3.length();
  m.quaternion.setFromUnitVectors(UP, _v3.normalize());
  m.scale.set(1, len, 1);
}
// Локоть: середина плечо–кисть, сдвинутая вниз-наружу
function elbowOf(sh, hand, side, out) {
  const L = 0.31;
  _v1.copy(hand).sub(sh);
  const d = Math.min(_v1.length(), 2 * L - 0.001);
  const h = Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2)));
  _v2.set(side * 0.6, -1, 0.35);
  const n = _v1.clone().normalize();
  _v2.sub(n.clone().multiplyScalar(_v2.dot(n))).normalize();
  return out.copy(sh).add(hand).multiplyScalar(0.5).addScaledVector(_v2, h);
}

// ---------- Клинок ----------
class Blade {
  constructor(color, scene) {
    this.group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0b8, metalness: 0.85, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23263a, metalness: 0.6, roughness: 0.5 });
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.26, 12), metal);
    hilt.position.y = 0.05;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 12), dark);
    grip.position.y = 0.0;
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
    this.color = c;
    this.glow.material.color.copy(c);
    this.halo.material.color.copy(c);
    this.light.color.copy(c);
    this.trail.setColor(c);
  }

  setIgnite(k) {
    const len = CFG.BLADE_LEN * Math.max(0.001, k);
    for (const m of [this.core, this.glow, this.halo]) { m.scale.y = len; m.visible = k > 0.01; }
    this.light.intensity = 1.4 * k;
    this.light.position.y = 0.2 + len * 0.5;
    this.ignite = k;
  }

  orient(h, d) {
    this.group.position.set(h[0], h[1], h[2]);
    _v1.set(d[0], d[1], d[2]);
    this.group.quaternion.setFromUnitVectors(UP, _v1);
  }

  // Мировые координаты основания и острия (для шлейфа и частиц)
  sampleTrail(speed) {
    if (this.ignite < 0.3) { this.trail.reset(); return; }
    this.group.updateMatrixWorld(true);
    const base = new THREE.Vector3(0, 0.25, 0).applyMatrix4(this.group.matrixWorld);
    const tip = new THREE.Vector3(0, 0.21 + CFG.BLADE_LEN * this.ignite, 0).applyMatrix4(this.group.matrixWorld);
    this.trail.push(base, tip, clamp((speed - 3) / 10, 0, 1));
  }
}

// Шлейф взмаха: лента из последних положений клинка
class Trail {
  constructor(scene, n = 14) {
    this.n = n;
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
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
      const p = s[Math.min(i, s.length - 1)];
      const o = i * 6;
      this.pos[o] = p.b.x; this.pos[o + 1] = p.b.y; this.pos[o + 2] = p.b.z;
      this.pos[o + 3] = p.t.x; this.pos[o + 4] = p.t.y; this.pos[o + 5] = p.t.z;
      const a = (1 - i / this.n) * p.s * 0.55;
      this.col[o] = this.c.r * a * 0.3; this.col[o + 1] = this.c.g * a * 0.3; this.col[o + 2] = this.c.b * a * 0.3;
      this.col[o + 3] = this.c.r * a; this.col[o + 4] = this.c.g * a; this.col[o + 5] = this.c.b * a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
  }
}

// ---------- Модель бойца (противник, а в демо — оба) ----------
class BodyModel {
  constructor(color, scene) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    const armor = new THREE.MeshStandardMaterial({ color: 0x3a3f5e, roughness: 0.45, metalness: 0.5 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x1c1d2e, roughness: 0.95, side: THREE.DoubleSide });
    this.accent = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.armor = armor;

    const body = this.body = new THREE.Group();
    this.root.add(body);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };

    add(new THREE.CylinderGeometry(0.2, 0.36, 0.62, 16, 1, true), cloth, 0, 0.66, 0);       // полы плаща
    this.torso = add(new THREE.BoxGeometry(0.42, 0.52, 0.24), armor, 0, 1.24, 0);
    add(new THREE.BoxGeometry(0.44, 0.06, 0.26), this.accent, 0, 1.0, 0);                   // пояс
    add(new THREE.SphereGeometry(0.09, 12, 8), armor, 0.24, 1.46, 0);                      // наплечники
    add(new THREE.SphereGeometry(0.09, 12, 8), armor, -0.24, 1.46, 0);
    this.head = add(new THREE.SphereGeometry(0.12, 16, 12), armor, 0, 1.62, 0);
    add(new THREE.SphereGeometry(0.14, 16, 12, 0, TAU, 0, Math.PI * 0.62), cloth, 0, 1.63, 0.02); // капюшон
    add(new THREE.BoxGeometry(0.15, 0.024, 0.02), this.accent, 0, 1.62, -0.118);           // визор

    this.legs = [-1, 1].map(s => {
      const thigh = limbMesh(0.07, cloth), shin = limbMesh(0.06, armor);
      body.add(thigh, shin);
      return { s, thigh, shin };
    });
    this.arms = [-1, 1].map(s => {
      const up = limbMesh(0.05, cloth), fo = limbMesh(0.045, armor);
      body.add(up, fo);
      return { s, up, fo };
    });

    this.rig = new THREE.Group();
    this.rig.position.y = CFG.EYE;
    body.add(this.rig);
    this.blade = new Blade(color, scene);
    this.rig.add(this.blade.group);
    this.anim = new PoseAnim();
    this.setColor(color);
  }

  setColor(hex) { this.blade.setColor(hex); this.accent.color.set(hex); }
  setVisible(v) { this.root.visible = v; this.blade.trail.mesh.visible = v && this.blade.trail.mesh.visible; this.visible = v; }

  update(f, time, dt) {
    const pose = this.anim.update(f, time, dt);
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.y = f.yaw;
    const fall = f.dead ? Math.min(1, f.deathT * 2.4) : 0;
    this.root.rotation.x = easeOut(fall) * 1.45;
    const lean = f.state === 'stagger' ? Math.sin(clamp(f.stateT / f.dur, 0, 1) * Math.PI) * 0.18 : 0;
    this.body.rotation.x = lean;
    const twist = f.state === 'windup' || f.state === 'strike' ? (f.attack.dir === DIR.RIGHT ? -0.25 : f.attack.dir === DIR.LEFT ? 0.25 : 0) : 0;
    this.torso.rotation.y = lerp(this.torso.rotation.y, twist, 0.2);

    this.blade.orient(pose.h, pose.d);
    this.blade.setIgnite(f.ignite);
    this.accent.color.set(f.hitFlash > 0 ? '#ffffff' : f.color);

    // Ноги: шаг по скорости
    const mv = Math.min(1, f.speed / CFG.WALK);
    for (const L of this.legs) {
      const ph = Math.sin(f.walkPhase + (L.s > 0 ? 0 : Math.PI));
      const hip = new THREE.Vector3(L.s * 0.11, 0.92, 0);
      const foot = new THREE.Vector3(L.s * 0.13, Math.max(0, -ph) * 0.12 * mv, -ph * 0.28 * mv + L.s * 0.06);
      const knee = new THREE.Vector3((hip.x + foot.x) / 2, (hip.y + foot.y) / 2 + 0.02, (hip.z + foot.z) / 2 - 0.12);
      setLimb(L.thigh, hip, knee); setLimb(L.shin, knee, foot);
    }
    // Руки к рукояти
    const hand = new THREE.Vector3(pose.h[0], pose.h[1] + CFG.EYE, pose.h[2]);
    const dirv = new THREE.Vector3(pose.d[0], pose.d[1], pose.d[2]);
    const hand2 = hand.clone().addScaledVector(dirv, -0.1);
    for (const A of this.arms) {
      const sh = new THREE.Vector3(A.s * 0.22, 1.45, 0);
      const target = A.s > 0 ? hand : hand2;
      const el = elbowOf(sh, target, A.s, new THREE.Vector3());
      setLimb(A.up, sh, el); setLimb(A.fo, el, target);
    }

    this.root.updateMatrixWorld(true);
    if (this.visible !== false) this.blade.sampleTrail(this.anim.speed);
  }
}

// ---------- Руки и клинок от первого лица ----------
class ViewModel {
  constructor(color, camera, scene) {
    this.group = new THREE.Group();
    camera.add(this.group);
    const glove = new THREE.MeshStandardMaterial({ color: 0x1b1e30, roughness: 0.55, metalness: 0.4 });
    this.fore = [limbMesh(0.032, glove), limbMesh(0.032, glove)];
    this.group.position.set(0.05, -0.07, -0.03);
    this.fore.forEach(m => { m.castShadow = false; this.group.add(m); });
    this.blade = new Blade(color, scene);
    this.group.add(this.blade.group);
    this.anim = new PoseAnim();
  }
  setColor(hex) { this.blade.setColor(hex); }
  setVisible(v) { this.group.visible = v; if (!v) this.blade.trail.reset(); this.visible = v; }

  update(f, time, dt, bob) {
    const pose = this.anim.update(f, time, dt);
    const h = [pose.h[0] + bob.x, pose.h[1] + bob.y, pose.h[2]];
    this.blade.orient(h, pose.d);
    this.blade.setIgnite(f.ignite);
    const hand = new THREE.Vector3(h[0], h[1], h[2]);
    const hand2 = hand.clone().addScaledVector(new THREE.Vector3(...pose.d), -0.1);
    setLimb(this.fore[0], new THREE.Vector3(0.32, -0.62, 0.05), hand);
    setLimb(this.fore[1], new THREE.Vector3(-0.22, -0.62, 0.05), hand2);
    if (this.visible) this.blade.sampleTrail(this.anim.speed);
  }
}
