'use strict';
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// ---------- Внешность ----------
const LOOKS = {
  skins: ['#f1d3b5', '#e2b48f', '#c48d66', '#9a6646', '#6b4430'],
  hairs: ['#2a1d14', '#4a3020', '#151515', '#7a5a3a', '#a88660', '#8c8c8c'],
};
function makeLook(outfit, o = {}) {
  const robe = outfit === 'robe';
  return {
    outfit,
    skin: o.skin ?? LOOKS.skins[1],
    hair: o.hair ?? LOOKS.hairs[1],
    beard: o.beard ?? false,
    longHair: o.longHair ?? false,
    tunic: robe ? '#a8946f' : '#3c4254',
    trousers: robe ? '#8c7656' : '#252935',
    boots: '#2b1f17',
    belt: '#3d2b1c',
    outer: o.outer ?? (robe ? '#5b3f29' : '#3a1f2a'),
  };
}
function randomLook(outfit) {
  return makeLook(outfit, {
    skin: LOOKS.skins[randInt(LOOKS.skins.length)],
    hair: LOOKS.hairs[randInt(LOOKS.hairs.length)],
    beard: chance(0.5), longHair: chance(0.35),
  });
}

const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0 }, o));

function limbMesh(r, m, r2) {
  const g = new THREE.CylinderGeometry(r, r2 ?? r * 0.9, 1, 12, 1, !!(r2 && m.side === THREE.DoubleSide));
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}
// Растягивает цилиндр высотой 1 между точками a и b
function setLimb(m, a, b) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  _v3.copy(b).sub(a);
  const len = _v3.length() || 0.001;
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

// ---------- Человек ----------
class BodyModel {
  constructor(look, color, scene) {
    this.scene = scene;
    this.look = look;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    this.flipG = new THREE.Group(); this.flipG.position.y = 1.0;
    this.root.add(this.flipG);
    const body = this.body = new THREE.Group(); body.position.y = -1.0;
    this.flipG.add(body);

    const L = look, robe = L.outfit === 'robe';
    const skin = mat(L.skin, { roughness: 0.65 });
    this.tunicMat = mat(L.tunic);
    const tunicDark = mat(new THREE.Color(L.tunic).multiplyScalar(0.7));
    const trousers = mat(L.trousers), boots = mat(L.boots, { roughness: 0.6 }), belt = mat(L.belt, { roughness: 0.6 });
    const hair = mat(L.hair, { roughness: 0.95, side: THREE.DoubleSide });
    const outer = mat(L.outer, { roughness: 0.95, side: THREE.DoubleSide });
    const metal = mat(0xb9a36a, { metalness: 0.8, roughness: 0.35 });
    const dark = mat(0x1a1210);
    this.skinMat = skin;

    const add = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };

    // Корпус
    add(new THREE.BoxGeometry(0.3, 0.16, 0.2), trousers, 0, 0.95, 0);
    this.torso = add(new THREE.CylinderGeometry(0.19, 0.16, 0.5, 16), this.tunicMat, 0, 1.22, 0);
    this.torso.scale.z = 0.62;
    for (const s of [-1, 1]) {
      const strip = add(new THREE.BoxGeometry(0.035, 0.36, 0.01), tunicDark, s * 0.045, 1.27, -0.106);
      strip.rotation.z = s * 0.38;
    }
    add(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 16), belt, 0, 1.0, 0).scale.z = 0.66;
    add(new THREE.BoxGeometry(0.05, 0.045, 0.02), metal, 0, 1.0, -0.118);
    add(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 10), skin, 0, 1.5, 0);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.068, 12, 8), this.tunicMat, s * 0.2, 1.44, 0);

    // Голова и лицо
    const head = this.head = new THREE.Group(); head.position.set(0, 1.62, 0); body.add(head);
    add(new THREE.SphereGeometry(0.11, 20, 16), skin, 0, 0, 0, head).scale.set(0.9, 1.05, 0.98);
    add(new THREE.SphereGeometry(0.085, 16, 12), skin, 0, -0.05, -0.02, head).scale.set(0.9, 0.8, 1);
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.016, 8, 6), mat(0xf4f1ea, { roughness: 0.3 }), s * 0.038, 0.012, -0.093, head);
      add(new THREE.SphereGeometry(0.009, 8, 6), mat(0x2a1c12, { roughness: 0.2 }), s * 0.038, 0.012, -0.106, head);
      add(new THREE.BoxGeometry(0.038, 0.009, 0.012), hair, s * 0.038, 0.042, -0.1, head).rotation.z = -s * 0.12;
      add(new THREE.SphereGeometry(0.022, 8, 6), skin, s * 0.1, 0, 0, head).scale.set(0.5, 1, 0.8);
    }
    add(new THREE.BoxGeometry(0.022, 0.045, 0.03), skin, 0, -0.012, -0.108, head).rotation.x = 0.2;
    add(new THREE.BoxGeometry(0.04, 0.008, 0.01), mat(0x7a3b34), 0, -0.058, -0.094, head);
    const cap = add(new THREE.SphereGeometry(0.118, 20, 12, 0, TAU, 0, Math.PI * 0.52), hair, 0, 0.015, 0.006, head);
    cap.rotation.x = -0.38;
    if (L.longHair) add(new THREE.CylinderGeometry(0.095, 0.11, 0.18, 14), hair, 0, -0.08, 0.05, head);
    if (L.beard) add(new THREE.SphereGeometry(0.1, 16, 10, Math.PI, Math.PI, Math.PI * 0.55, Math.PI * 0.4), hair, 0, -0.018, -0.004, head);

    // Ноги
    this.legs = [-1, 1].map(s => {
      const thigh = limbMesh(0.07, trousers), shin = limbMesh(0.06, trousers), shaft = limbMesh(0.068, boots);
      const boot = add(new THREE.BoxGeometry(0.1, 0.09, 0.22), boots, 0, 0, 0);
      body.add(thigh, shin, shaft);
      return { s, thigh, shin, shaft, boot };
    });

    // Руки
    const sleeveMat = robe ? outer : this.tunicMat;
    this.arms = [-1, 1].map(s => {
      const up = limbMesh(robe ? 0.062 : 0.052, sleeveMat), fo = limbMesh(0.044, this.tunicMat);
      const hand = add(new THREE.SphereGeometry(0.042, 10, 8), skin, 0, 0, 0);
      body.add(up, fo);
      let sleeve = null;
      if (robe) { sleeve = limbMesh(0.05, outer, 0.085); body.add(sleeve); }
      return { s, up, fo, hand, sleeve };
    });

    // Верхняя одежда
    if (robe) {
      this.skirt = add(new THREE.CylinderGeometry(0.21, 0.44, 1.22, 24, 6, true, Math.PI + 0.45, TAU - 0.9), outer, 0, 0.82, 0);
      add(new THREE.SphereGeometry(0.24, 20, 10, Math.PI * 1.5 + 0.5, TAU - 1.0, 0, Math.PI * 0.42), outer, 0, 1.36, 0).scale.z = 0.68;
      const hood = add(new THREE.SphereGeometry(0.14, 16, 10, 0, TAU, 0, Math.PI / 2), outer, 0, 1.49, 0.12);
      hood.rotation.x = 1.9; hood.scale.set(1, 0.7, 1);
    } else {
      add(new THREE.SphereGeometry(0.235, 20, 8, 0, TAU, 0, Math.PI * 0.3), outer, 0, 1.39, 0).scale.z = 0.7;
      add(new THREE.SphereGeometry(0.022, 8, 6), metal, 0, 1.44, -0.12);
      const g = new THREE.PlaneGeometry(0.66, 1.25, 6, 12);
      g.translate(0, -0.625, 0);
      this.cape = add(g, outer, 0, 1.46, 0.13);
      this.capeBase = Float32Array.from(g.attributes.position.array);
    }
    // Тёмная подкладка под одеждой ног, чтобы не просвечивало
    if (robe) add(new THREE.CylinderGeometry(0.2, 0.3, 0.6, 16, 1, true), dark, 0, 0.55, 0);

    this.rig = new THREE.Group();
    this.rig.position.y = CFG.EYE;
    body.add(this.rig);
    this.blade = new Blade(color, scene);
    this.rig.add(this.blade.group);
    this.anim = new PoseAnim();
    this.visible = true;
  }

  setColor(hex) { this.blade.setColor(hex); }
  setVisible(v) { this.root.visible = v; if (!v) this.blade.trail.reset(); this.visible = v; }
  dispose() { this.scene.remove(this.root); this.blade.dispose(this.scene); }

  update(f, time, dt) {
    const pose = this.anim.update(f, time, dt);
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.yaw;
    const fall = f.dead ? Math.min(1, f.deathT * 2.4) : 0;
    this.root.rotation.x = easeOut(fall) * 1.45;

    // Сальто: вращение вокруг таза
    let fx = 0, fz = 0;
    if (f.flip) {
      const k = easeInOut(clamp(f.flip.t / CFG.FLIP_DUR, 0, 1)) * TAU;
      if (f.flip.type === 'front') fx = -k; else if (f.flip.type === 'back') fx = k;
      else if (f.flip.type === 'right') fz = -k; else fz = k;
    }
    this.flipG.rotation.set(fx, 0, fz);

    let lean = f.state === 'stagger' ? Math.sin(clamp(f.stateT / f.dur, 0, 1) * Math.PI) * 0.18 : 0;
    if (f.state === 'mantle') lean = -0.35;
    this.body.rotation.x = lean;
    const tw = f.state === 'windup' || f.state === 'strike' ? (isRightSide(f.attack.dir) ? -0.25 : isLeftSide(f.attack.dir) ? 0.25 : 0) : 0;
    this.torso.rotation.y = lerp(this.torso.rotation.y, tw, 0.2);

    this.blade.orient(pose.h, pose.d);
    this.blade.setIgnite(f.ignite);
    this.tunicMat.emissive.setRGB(f.hitFlash > 0 ? 0.5 : 0, 0, 0);

    // Ноги: шаг на земле, поджатые в воздухе
    const mv = Math.min(1, f.speed / CFG.WALK), air = !f.onGround && !f.dead;
    for (const Lg of this.legs) {
      const hip = new THREE.Vector3(Lg.s * 0.1, 0.92, 0);
      let foot, knee;
      if (air || f.state === 'mantle') {
        foot = new THREE.Vector3(Lg.s * 0.12, 0.42 + (Lg.s > 0 ? 0.08 : 0), 0.05);
        knee = new THREE.Vector3(Lg.s * 0.12, 0.72, -0.3);
      } else {
        const ph = Math.sin(f.walkPhase + (Lg.s > 0 ? 0 : Math.PI));
        foot = new THREE.Vector3(Lg.s * 0.12, 0.05 + Math.max(0, -ph) * 0.12 * mv, -ph * 0.28 * mv + Lg.s * 0.06);
        knee = new THREE.Vector3((hip.x + foot.x) / 2, (hip.y + foot.y) / 2 + 0.02, (hip.z + foot.z) / 2 - 0.12);
      }
      setLimb(Lg.thigh, hip, knee); setLimb(Lg.shin, knee, foot);
      setLimb(Lg.shaft, foot, foot.clone().lerp(knee, 0.45));
      Lg.boot.position.set(foot.x, foot.y - 0.01, foot.z - 0.05);
    }

    // Руки к рукояти
    const hand = new THREE.Vector3(pose.h[0], pose.h[1] + CFG.EYE, pose.h[2]);
    const hand2 = hand.clone().addScaledVector(_v1.set(pose.d[0], pose.d[1], pose.d[2]), -0.1);
    for (const A of this.arms) {
      const sh = new THREE.Vector3(A.s * 0.21, 1.44, 0);
      const target = A.s > 0 ? hand : hand2;
      const el = elbowOf(sh, target, A.s, new THREE.Vector3());
      setLimb(A.up, sh, el); setLimb(A.fo, el, target);
      A.hand.position.copy(target);
      if (A.sleeve) setLimb(A.sleeve, el, el.clone().lerp(target, 0.75));
    }

    // Одежда реагирует на движение
    const fw = fwdOf(f.yaw), rt = rightOf(f.yaw);
    const vf = f.vx * fw.x + f.vz * fw.z, vs = f.vx * rt.x + f.vz * rt.z;
    if (this.skirt) {
      this.skirt.rotation.x = lerp(this.skirt.rotation.x, clamp(-vf * 0.05, -0.2, 0.2) + (air ? -0.15 : 0), 0.15);
      const fl = air ? 1.12 : 1 + Math.min(0.06, f.speed * 0.015);
      this.skirt.scale.set(fl, 1, fl);
    }
    if (this.cape) {
      const pos = this.cape.geometry.attributes.position, b = this.capeBase;
      const flow = 0.06 + 0.18 * clamp(Math.max(0, vf) / 3, 0, 1) + (air ? 0.3 : 0) + (f.flip ? 0.2 : 0);
      for (let i = 0; i < pos.count; i++) {
        const bx = b[i * 3], by = b[i * 3 + 1], v = -by / 1.25;
        const z = v * v * flow + Math.sin(time * 3 + v * 5 + bx * 4) * 0.02 * v;
        pos.setXYZ(i, bx - vs * 0.05 * v * v, by + z * 0.35, z);
      }
      pos.needsUpdate = true;
      this.cape.geometry.computeVertexNormals();
    }

    this.root.updateMatrixWorld(true);
    if (this.visible) this.blade.sampleTrail(this.anim.speed);
  }
}

// ---------- Руки и клинок от первого лица ----------
class ViewModel {
  constructor(look, color, camera, scene) {
    this.group = new THREE.Group();
    this.group.position.set(0.05, -0.07, -0.03);
    camera.add(this.group);
    this.blade = new Blade(color, scene);
    this.group.add(this.blade.group);
    this.anim = new PoseAnim();
    this.parts = [];
    this.setLook(look);
  }
  setLook(look) {
    for (const p of this.parts) this.group.remove(p);
    const robe = look.outfit === 'robe';
    const sleeve = mat(robe ? look.outer : look.tunic, { side: THREE.DoubleSide });
    const skin = mat(look.skin, { roughness: 0.65 });
    this.fore = [limbMesh(robe ? 0.04 : 0.032, sleeve, robe ? 0.06 : undefined), limbMesh(robe ? 0.04 : 0.032, sleeve, robe ? 0.06 : undefined)];
    this.hands = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), skin));
    this.parts = [...this.fore, ...this.hands];
    for (const p of this.parts) { p.castShadow = false; this.group.add(p); }
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
    setLimb(this.fore[0], new THREE.Vector3(0.32, -0.62, 0.05), hand.clone().lerp(new THREE.Vector3(0.32, -0.62, 0.05), 0.12));
    setLimb(this.fore[1], new THREE.Vector3(-0.22, -0.62, 0.05), hand2.clone().lerp(new THREE.Vector3(-0.22, -0.62, 0.05), 0.12));
    this.hands[0].position.copy(hand); this.hands[1].position.copy(hand2);
    if (this.visible) this.blade.sampleTrail(this.anim.speed);
  }
}
