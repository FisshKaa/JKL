'use strict';
// Персонаж: скелет + сетки из CharGen + ткань + процедурная анимация (IK рук и ног).
const CharCache = new Map();
function charKey(look) { const L = Object.assign({}, look); delete L.colors; delete L.name; delete L.style; delete L.weapon; return JSON.stringify(L) + '|' + CharGen.detail; }
function getCharData(look) {
  const k = charKey(look);
  if (!CharCache.has(k)) CharCache.set(k, CharGen.build(look));
  return CharCache.get(k);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Vector3(), _n = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qm = new THREE.Quaternion();
const expTo = (v, t, rate, dt) => v + (t - v) * (1 - Math.exp(-rate * dt));
// Поворот вектора v вокруг оси a на угол (формула Родрига), массивы [x,y,z]
function rot3(v, a, ang) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1, x = a[0] / l, y = a[1] / l, z = a[2] / l, c = Math.cos(ang), s = Math.sin(ang);
  const d = v[0] * x + v[1] * y + v[2] * z;
  return [v[0] * c + (y * v[2] - z * v[1]) * s + x * d * (1 - c), v[1] * c + (z * v[0] - x * v[2]) * s + y * d * (1 - c), v[2] * c + (x * v[1] - y * v[0]) * s + z * d * (1 - c)];
}
const mirrorPose = p => ({ h: [-p.h[0], p.h[1], p.h[2]], d: [-p.d[0], p.d[1], p.d[2]] });
const smoothPose = (cur, tgt, k) => ({ h: lerp3(cur.h, tgt.h, k), d: norm3(lerp3(cur.d, tgt.d, k)) });
// Как форма отбивает удар в момент блока
const PARRY = { shii: 'down', makashi: 'circle', soresu: 'roll', ataru: 'hop', djemso: 'beat', niman: 'palm', juyo: 'flick' };
// Вращение клинка (кнопка G): у каждого оружия своё, у одиночного клинка — своё для каждой формы
const FLOURISH_SINGLE = { shii: ['wide', 1.3], makashi: ['salute', 1.6], soresu: ['eight', 1.2], ataru: ['pirouette', 1.2], djemso: ['heli', 1.4], niman: ['palm', 1.3], juyo: ['zigzag', 1.0] };
function flourishOf(f) {
  if (f.weapon === 'staff') return f.style === 'ataru' || f.style === 'juyo' ? ['staffSpin', 1.6] : ['staff', 1.5];
  if (f.weapon === 'dual') return ['dual', 1.4];
  if (f.weapon === 'reverse') return ['reverse', 1.2];
  return FLOURISH_SINGLE[f.style] || ['wind', 1.2];
}
const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
// Мельница сбоку от тела: клинок вращается в вертикальной плоскости, кисть вынесена в сторону — не задевает себя
const windmill = (sgn, ang, hx = 0.42) => ({ h: [hx * sgn, -0.24, -0.26], d: rot3([0, 1, 0], [1, 0, 0], -ang) });

// Повернуть кость так, чтобы её направление на ребёнка смотрело в dirWorld, а «полюс» — в poleWorld
function aimBone(bone, restDir, dirWorld, restPole, poleWorld) {
  bone.parent.getWorldQuaternion(_q1);
  const inv = _q2.copy(_q1).invert();
  const d = _a.copy(dirWorld).applyQuaternion(inv).normalize();
  const q = _q3.setFromUnitVectors(restDir, d);
  if (poleWorld) {
    const u = _b.copy(restPole).applyQuaternion(q);
    const ud = _c.copy(poleWorld).applyQuaternion(inv);
    u.addScaledVector(d, -u.dot(d)); ud.addScaledVector(d, -ud.dot(d));
    if (u.lengthSq() > 1e-8 && ud.lengthSq() > 1e-8) {
      u.normalize(); ud.normalize();
      const ang = Math.atan2(_e.crossVectors(u, ud).dot(d), u.dot(ud));
      q.premultiply(_q1.setFromAxisAngle(d, ang));
    }
  }
  bone.quaternion.copy(q);
  bone.updateMatrixWorld(true);
}

function makeEyeTexture(iris) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e4dcd2'; g.fillRect(0, 0, 256, 128);
  const cx = 192, cy = 64;
  const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 30);
  gr.addColorStop(0, '#0a0806'); gr.addColorStop(0.32, '#0a0806'); gr.addColorStop(0.36, iris); gr.addColorStop(0.9, iris); gr.addColorStop(1, '#2a2018');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 30, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(cx - 7, cy - 7, 3, 0, TAU); g.fill();
  return new THREE.CanvasTexture(c);
}

class Character {
  // fpOwner: это персонаж игрока — его голову прячем в виде от первого лица
  constructor(look, bladeColor, scene, fpOwner = false) {
    this.scene = scene;
    this.look = cloneLook(look);
    this.key = charKey(look);
    this.scale = lookScale(look);
    const data = getCharData(look);
    const J = this.J = data.J;

    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ';
    this.flipG = new THREE.Group(); this.flipG.position.y = 1.0 * this.scale;
    this.modelG = new THREE.Group(); this.modelG.position.y = -1.0 * this.scale; this.modelG.scale.setScalar(this.scale);
    this.root.add(this.flipG); this.flipG.add(this.modelG);
    scene.add(this.root);

    // Кости: поворот в покое — единичный, так проще считать IK
    this.bones = {};
    for (const name of RIG_BONES) {
      const b = new THREE.Bone(); b.name = name;
      const p = J.bone[name], par = RIG_PARENT[name];
      if (par) { const pp = J.bone[par]; b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]); this.bones[par].add(b); }
      else { b.position.set(p[0], p[1], p[2]); this.modelG.add(b); }
      this.bones[name] = b;
    }
    this.rest = {};
    for (const name of RIG_BONES) this.rest[name] = this.bones[name].position.clone();
    this.restDir = {};
    const childOf = { upperArmR: 'foreArmR', foreArmR: 'handR', upperArmL: 'foreArmL', foreArmL: 'handL', thighR: 'shinR', shinR: 'footR', thighL: 'shinL', shinL: 'footL' };
    for (const [b, c] of Object.entries(childOf)) this.restDir[b] = this.rest[c].clone().normalize();
    this.lenOf = b => this.rest[childOf[b]].length() * this.scale;
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(RIG_BONES.map(n => this.bones[n]));

    this.mats = this.makeMaterials(look);
    this.meshes = [];
    this.fpMeshes = [];
    for (const part of data.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(part.geo.positions.slice(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(part.geo.normals, 3));
      if (part.geo.colors) g.setAttribute('color', new THREE.BufferAttribute(part.geo.colors, 3));
      g.setIndex(new THREE.BufferAttribute(part.geo.indices, 1));
      const key = part.mat === 'skin' ? (part.key === 'head' ? 'head' : 'skin') : part.mat;
      let m = this.mats[key];
      if (!part.rigid) {
        // В r128 скиннинговым сеткам нужен отдельный материал с флагом skinning
        const sk = key + '_sk';
        if (!this.mats[sk]) { this.mats[sk] = m.clone(); this.mats[sk].skinning = true; }
        m = this.mats[sk];
      }
      let mesh;
      if (part.rigid) {
        const bp = J.bone[part.rigid];
        if (!part.local) g.translate(-bp[0], -bp[1], -bp[2]);
        mesh = new THREE.Mesh(g, m);
        this.bones[part.rigid].add(mesh);
      } else {
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(part.skinIndex, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(part.skinWeight, 4));
        mesh = new THREE.SkinnedMesh(g, m);
        this.modelG.add(mesh);
        mesh.bind(this.skeleton);
        mesh.frustumCulled = false;
      }
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (part.fpHide) this.fpMeshes.push(mesh);
      this.meshes.push(mesh);
    }

    // Глаза
    const eyeMat = new THREE.MeshStandardMaterial({ map: makeEyeTexture(look.eyes || '#4a3324'), roughness: 0.15 });
    this.meshes.push(eyeMat);
    this.eyes = [];
    this.blinkT = rand(1.5, 4); this.blinkK = 0;
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0112, 16, 12), eyeMat);
      this.eyes.push(e);
      e.position.set(0.032 * s, J.eyeLocal[1], -0.0728);
      this.fpMeshes.push(e);
      this.bones.head.add(e);
    }
    this.eyeAnchor = new THREE.Object3D();
    this.eyeAnchor.position.set(0, J.eyeLocal[1], J.eyeLocal[2] - 0.01);
    this.bones.head.add(this.eyeAnchor);

    this.setFpOwner(fpOwner);
    this.blade = new Blade(bladeColor, scene);
    this.bladeColor = bladeColor;
    scene.add(this.blade.group);
    this.poseAnim = new PoseAnim();

    this.cloth = [];
    this.buildCloth(look);

    Object.assign(this, { airK: 0, land: 0, wasAir: false, lastVy: 0, tuck: 0, crouch: 0.05, lean: 0, twist: 0, visible: true });
    this.blade2 = null;                       // второй клинок: для двух клинков и посоха
    this.flT = rand(2, 5); this.flourish = null;
    this.dualR = null; this.dualL = null;
    this.root.updateMatrixWorld(true);
  }

  makeMaterials(look) {
    const C = look.colors, std = (c, r = 0.9, m = 0, side = THREE.FrontSide, vc = true) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, side, vertexColors: vc });
    return {
      head: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
      skin: std(look.skin, 0.6, 0, THREE.FrontSide, false),
      hair: std(look.hairColor, 0.55, 0.05, THREE.FrontSide, false),
      tunic: std(C.tunic, 0.9), under: std(C.under, 0.9), sash: std(C.sash, 0.85),
      belt: std(C.belt, 0.5, 0.05), trousers: std(C.trousers, 0.9), boots: std(C.boots, 0.55, 0.05),
      outer: std(C.outer, 0.95), armor: std(C.armor, 0.32, 0.15),
      outerCloth: std(C.outer, 0.95, 0, THREE.DoubleSide), tunicCloth: std(C.tunic, 0.9, 0, THREE.DoubleSide),
    };
  }

  // Применить новые цвета без перестройки геометрии
  setColors(look) {
    const C = look.colors;
    for (const [k, c] of [['tunic', C.tunic], ['under', C.under], ['sash', C.sash], ['belt', C.belt], ['trousers', C.trousers], ['boots', C.boots], ['outer', C.outer], ['armor', C.armor], ['outerCloth', C.outer], ['tunicCloth', C.tunic]]) {
      this.mats[k].color.set(c);
      if (this.mats[k + '_sk']) this.mats[k + '_sk'].color.set(c);
    }
  }

  buildCloth(look) {
    const J = this.J, m = 0.9 + 0.2 * look.build, hy = J.hips[1];
    // Радиусы юбки мантии на высоте y (модельные координаты)
    const robeR = Y => { const t = clamp((0.985 - Y) / 0.86, 0, 1); return [lerp(0.2, 0.37, t) * m, lerp(0.15, 0.31, t) * m]; };
    const robe = look.outer === 'robe';
    // «Оболочки» в системе таза: не даём слоям ткани проходить друг сквозь друга
    const ell = (lx, lz, rx, rz) => Math.sqrt((lx / rx) ** 2 + (lz / rz) ** 2);
    if (robe) {
      const cols = 18, rows = 10, gap = 0.95;
      this.cloth.push(new ClothPanel(this, {
        cols, rows, material: this.mats.outerCloth, stiff: 0.45, collide: ['leg', 'hip'],
        rest: (i, j) => {
          const th = gap / 2 + (TAU - gap) * i / (cols - 1), t = j / (rows - 1);
          const fold = 1 + 0.06 * t * Math.sin(th * 9);   // вертикальные складки
          const rx = lerp(0.2, 0.37, t) * m * fold, rz = lerp(0.15, 0.31, t) * m * fold;
          return [Math.sin(th) * rx, 0.985 - t * 0.86, -Math.cos(th) * rz];
        },
        pin: (i, j) => (j === 0 ? 'hips' : null),
        shell: { bone: 'hips', fn: (p) => {
          if (p.y > 0.03) p.y = 0.03;                  // юбка не взлетает выше пояса (и не цепляется за плечи)
          // Сзади мантия не ложится на полы туники; по бокам и спереди свободна
          if (look.tails && p.z > 0.0) {
            const [rx, rz] = robeR(p.y + hy), e = ell(p.x, p.z, rx, rz), min = 0.68;
            if (e < min && e > 1e-4) { p.x *= min / e; p.z *= min / e; }
          }
        } },
      }));
    }
    if (look.tails) {
      const fz = 0.12 + (look.sash ? 0.035 : 0.025);
      for (const side of [-1, 1]) {
        this.cloth.push(new ClothPanel(this, {
          cols: 6, rows: 9, material: this.mats.tunicCloth, stiff: 0.4, collide: ['leg', 'hip'],
          rest: (i, j) => {
            const t = j / 8, w = side < 0 ? 0.11 : 0.13, u = i / 5;
            const fold = Math.sin(u * Math.PI * 2.5) * 0.012 * t;   // мягкие складки по ширине
            return [lerp(-w, w, u) * (1 + t * 0.15), 0.965 - t * 0.43, side * (fz + 0.005 + t * 0.02 + fold + 0.02 * Math.sin(u * Math.PI) * t)];
          },
          pin: (i, j) => (j === 0 ? 'hips' : null),
          shell: { bone: 'hips', fn: (p) => {
            if (p.y > 0.0) p.y = 0.0;
            // Задняя пола под мантией не выходит наружу; полы не уходят внутрь ног
            if (robe && side > 0) { const [rx, rz] = robeR(p.y + hy), e = ell(p.x, p.z, rx, rz), max = 0.62; if (e > max) { p.x *= max / e; p.z *= max / e; } }
            if (side > 0 && p.z < 0.1) p.z = 0.1;
            if (side < 0 && p.z > -0.1) p.z = -0.1;
          } },
        }));
      }
    }
    if (look.outer === 'cape') {
      const cols = 10, rows = 13;
      this.cloth.push(new ClothPanel(this, {
        cols, rows, material: this.mats.outerCloth, stiff: 0.5, collide: ['leg', 'hip', 'torso', 'arm', 'head'],
        rest: (i, j) => {
          const u = i / (cols - 1), t = j / (rows - 1), x0 = lerp(-0.2, 0.2, u);
          return [x0 * (1 + t * 0.6), 1.45 - t * 1.12, 0.075 + 0.06 * (1 - (x0 / 0.2) ** 2) + t * 0.1];
        },
        pin: (i, j) => (j === 0 ? 'chest' : null),
        shell: { bone: 'hips', fn: (p) => {             // плащ всегда снаружи пояса, ягодиц и полов туники
          if (p.y > 0.42) p.y = 0.42;                 // плащ не закидывается на плечи
          if (p.y > 0.15) return;
          const e = ell(p.x, p.z - 0.02, 0.21, 0.19 + (look.tails ? 0.04 : 0));
          if (p.z > -0.05 && e < 1) { p.x /= Math.max(e, 0.3); p.z = 0.02 + (p.z - 0.02) / Math.max(e, 0.3); }
        } },
      }));
    }
    if (look.hair === 'pony') this.rope = new HairRope(this, this.mats.hair);
  }

  // Капсулы тела для ткани, с метками: юбки и полы видят только ноги и таз, плащ — всё
  colliders() {
    const s = this.scale, B = this.bones, w = (b, v) => b.getWorldPosition(v);
    const list = this._cols || (this._cols = Array.from({ length: 9 }, () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, tag: '' })));
    let k = 0;
    const cap = (a, b, r, tag) => { const c = list[k++]; c.a.copy(a); c.b.copy(b); c.r = r * s; c.tag = tag; };
    for (const S of ['L', 'R']) {
      cap(w(B['thigh' + S], _p), w(B['shin' + S], _t), 0.1, 'leg');
      cap(w(B['shin' + S], _p), w(B['foot' + S], _t), 0.07, 'leg');
    }
    cap(w(B.hips, _p), w(B.spine, _t), 0.165, 'hip');
    cap(w(B.spine, _p), w(B.neck, _t), 0.16, 'torso');
    cap(w(B.head, _p), _t.copy(this.eyeAnchor.getWorldPosition(_m)), 0.1, 'head');
    for (const S of ['L', 'R']) cap(w(B['upperArm' + S], _p), w(B['foreArm' + S], _t), 0.06, 'arm');
    return list.slice(0, k);
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v; this.blade.group.visible = v;
    if (this.blade2) { this.blade2.group.visible = v && this.blade2.used; if (!v) this.blade2.trail.reset(); }
    for (const c of this.cloth) c.mesh.visible = v;
    if (this.rope) this.rope.mesh.visible = v;
    if (!v) this.blade.trail.reset();
  }

  setBladeColor(c) { this.blade.setColor(c); this.bladeColor = c; if (this.blade2) this.blade2.setColor(c); }

  // Голову, волосы, глаза и капюшон своего бойца камера от первого лица не видит
  setFpOwner(v) { this.fpOwner = v; for (const m of this.fpMeshes) m.layers.set(v ? 1 : 0); }

  dispose() {
    this.scene.remove(this.root); this.scene.remove(this.blade.group); this.blade.dispose(this.scene);
    if (this.blade2) { this.scene.remove(this.blade2.group); this.blade2.dispose(this.scene); }
    for (const c of this.cloth) c.dispose();
    if (this.rope) this.rope.dispose();
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  eyeWorld(out) { return this.eyeAnchor.getWorldPosition(out); }

  twoBone(upper, lower, end, target, pole) {
    const A = upper.getWorldPosition(_m);
    const la = this.lenOf(upper.name), lb = this.lenOf(lower.name);
    const toT = _n.subVectors(target, A);
    const dist = clamp(toT.length(), 0.01, (la + lb) * 0.999);
    const dir = toT.normalize();
    const ca = clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1), sa = Math.sqrt(1 - ca * ca);
    const pp = _t.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0);
    pp.normalize();
    const elbow = _p.copy(A).addScaledVector(dir, la * ca).addScaledVector(pp, la * sa);
    const ppw = pp.clone(), Ac = A.clone(), dirc = dir.clone();
    aimBone(upper, this.restDir[upper.name], _e.subVectors(elbow, Ac).normalize().clone(), upper.name.startsWith('thigh') ? FWD_POLE : BACK_POLE, ppw);
    const Bp = lower.getWorldPosition(new THREE.Vector3());
    const T = Ac.addScaledVector(dirc, dist);
    aimBone(lower, this.restDir[lower.name], T.sub(Bp).normalize(), lower.name.startsWith('shin') ? FWD_POLE : BACK_POLE, ppw);
  }

  // ---------- Почерк поверх позы: отбив при блоке, игра с клинком, вращение посоха ----------
  overlay(f, pose, time, ap, mirrored) {
    let h = pose.h.slice(), d = pose.d.slice();
    const W = f.weapon || 'single', st = f.state, sgn = mirrored ? -1 : 1;
    const sinceB = time - f.blockFxT;
    if (sinceB >= 0 && sinceB < 0.42) {
      const k = sinceB / 0.42, amp = f.blockFxPerfect ? 1.35 : 1, bell = Math.sin(Math.PI * k) * amp;
      switch (W === 'staff' ? 'spin' : PARRY[f.style] || 'down') {
        case 'down': d = rot3(d, [1, 0, 0], -1.2 * bell); h[1] -= 0.16 * bell; break;            // сбить удар вниз
        case 'circle': d = rot3(d, [0, 0, -1], sgn * TAU * easeOut(k)); break;                    // отвести кругом
        case 'roll': d = rot3(d, [0, 0, -1], sgn * Math.PI * easeInOut(k)); h = lerp3(h, [0.1, -0.2, -0.34], 0.3 * bell); break;
        case 'hop': d = rot3(d, [0, 1, 0], sgn * 0.6 * bell); break;
        case 'beat': d = rot3(d, [1, 0, 0], -1.45 * bell); h[2] -= 0.1 * bell; break;            // мощный удар-отбив вниз
        case 'palm': d = rot3(d, [0, 0, -1], sgn * 1.2 * bell); break;
        case 'flick': d = rot3(d, [0, 1, 0], sgn * 1.15 * bell); h[0] += 0.08 * bell * sgn; break; // рывком в сторону
        case 'spin': d = rot3(d, [0, 0, -1], sgn * TAU * easeInOut(k)); break;                   // посох прокручивается
      }
    }
    if (this.flourish) {
      const F = this.flourish, k = clamp(F.t / F.dur, 0, 1);
      const wgt = smooth01(k / 0.14) * (1 - smooth01((k - 0.84) / 0.16));   // плавно вошли и вышли
      const e = easeInOut(clamp((k - 0.06) / 0.86, 0, 1));
      let T;
      switch (F.type) {
        case 'wind': T = windmill(sgn, TAU * 2 * e); break;
        case 'wide': { T = windmill(sgn, TAU * 2 * e, 0.5); T.d = rot3(T.d, [0, 1, 0], -0.5 * Math.sin(Math.PI * e) * sgn); break; }   // Шии-Чо: широкая дуга
        case 'zigzag': { const a = e < 0.5 ? e * 2 : 2 - e * 2; T = windmill(sgn, TAU * 1.5 * a); break; }                            // Джуйо: туда и рывком обратно
        case 'pirouette': case 'palm': T = windmill(sgn, TAU * 2 * e); break;
        case 'salute': {
          // Макаши: оборот сбоку, салют клинком у лица, затем низкая стойка остриём вниз
          if (e < 0.45) T = windmill(sgn, TAU * e / 0.45);
          else {
            const S = { h: [0.04 * sgn, -0.06, -0.26], d: [0, 1, -0.05] }, L = { h: [0.3 * sgn, -0.4, -0.3], d: norm3([0.25 * sgn, -0.5, -0.8]) };
            const u = (e - 0.45) / 0.55;
            T = u < 0.5 ? smoothPose(windmill(sgn, TAU), S, smooth01(u * 2)) : smoothPose(S, L, smooth01(u * 2 - 1));
          }
          break;
        }
        case 'eight': {
          // Соресу: восьмёрки кистью перед собой, клинок у тела
          const d0 = rot3([0, 1, 0], [0, 0, -1], Math.sin(TAU * 2 * e) * 1.4);
          T = { h: [0.16 * sgn, -0.2, -0.36], d: rot3(d0, [1, 0, 0], -Math.sin(TAU * e) * 0.7) };
          break;
        }
        case 'heli': {
          // Джем-Со: «вертолёт» над головой и обрушение в высокую стойку
          const dd = rot3([0, 0, -1], [0, 1, 0], TAU * 2 * e);
          T = { h: [0.1 * sgn, 0.2, -0.16], d: norm3([dd[0], 0.18, dd[2]]) };
          break;
        }
        case 'reverse': T = { h: [0.42 * sgn, -0.3, -0.3], d: rot3([0, 1, 0], [0, 0, -1], sgn * TAU * 2.5 * e) }; break;   // в обратном хвате — колесом у бедра
        case 'staff': case 'staffSpin': {
          // Посох: пропеллер перед собой одной рукой, затем вертикально сбоку
          if (e < 0.6) T = { h: [0.14, -0.14, -0.56], d: rot3([0, 1, 0], [0, 0, -1], TAU * 3 * e / 0.6) };
          else T = { h: [0.4, -0.2, -0.22], d: rot3([0, 1, 0], [1, 0, 0], -TAU * 2 * (e - 0.6) / 0.4) };
          break;
        }
        case 'dual': {
          // Два клинка: мельницы по бокам в разные стороны, в конце — крест перед собой
          T = windmill(sgn, sgn * TAU * 2 * e);
          if (e > 0.82) T = smoothPose(T, { h: [0.08 * sgn, -0.12, -0.4], d: norm3([-0.5 * sgn, 0.85, -0.1]) }, smooth01((e - 0.82) / 0.18));
          break;
        }
        default: T = windmill(sgn, TAU * 2 * e);
      }
      const m = smoothPose({ h, d }, T, wgt); h = m.h; d = m.d;
      if (!mirrored) this.flW = wgt;
    } else if (!mirrored) this.flW = 0;
    // Посох в связке и тяжёлом ударе крутится «пропеллером»
    if (W === 'staff' && (st === 'windup' || st === 'strike') && f.attack && (f.attack.combo >= 1 || f.attack.heavy)) d = rot3(d, [0, 0, -1], sgn * TAU * 0.75 * easeInOut(ap));
    return { h, d: norm3(d) };
  }

  // ---------- Анимация ----------
  update(f, ctx) {
    const { dt, time } = ctx;
    const B = this.bones, J = this.J, s = this.scale, st = f.state;
    const hanging = st === 'hang' || st === 'climb';
    const air = !f.onGround && !f.dead && !hanging && st !== 'vault' && st !== 'bind' && !f.wallRun;
    if (this.wasAir && !air && f.onGround) this.land = clamp(-this.lastVy / 9, 0.18, 0.9);
    this.wasAir = air; if (air) this.lastVy = f.vy;
    this.land = Math.max(0, this.land - dt * 2.4);
    this.airK = expTo(this.airK, air ? 1 : 0, 10, dt);
    const flipK = f.flip ? clamp(f.flip.t / CFG.FLIP_DUR, 0, 1) : 0;
    const rollK = st === 'roll' ? clamp(f.stateT / f.dur, 0, 1) : 0;
    this.tuck = expTo(this.tuck, f.flip ? Math.pow(Math.sin(Math.PI * flipK), 0.5) : st === 'roll' ? 1 : 0, 25, dt);
    const atk = st === 'windup' || st === 'strike';
    const SP = styleOf(f).pose;
    // Ход удара 0..1 (замах + удар) и сила выпада/шага: растёт к удару, гаснет в откате
    const ap = atk && f.attack ? clamp((st === 'windup' ? f.stateT : f.attack.windup + f.stateT) / (f.attack.windup + CFG.STRIKE), 0, 1) : 0;
    let lungeK = 0;
    if (atk) lungeK = clamp((ap - 0.45) / 0.4, 0, 1);
    else if (st === 'recover' && f.attack) lungeK = 1 - easeInOut(clamp(f.stateT / (f.dur * 0.75), 0, 1));
    this.lungeK = expTo(this.lungeK || 0, lungeK, 20, dt);
    const LK = this.lungeK;
    const stompK = st === 'strike' && SP.stomp ? Math.sin(Math.PI * clamp(f.stateT / CFG.STRIKE, 0, 1)) * SP.stomp : 0;
    const crouchT = 0.05 + (SP.crouch || 0) + 0.15 * LK * (SP.lunge || 0) + 0.35 * stompK + this.land * 0.8 + (f.prepT > 0 ? 0.55 : 0) + (st === 'dodge' ? 0.35 : 0) + (f.blocking ? 0.08 : 0) + (st === 'bind' ? 0.15 : 0) + (atk ? 0.1 : 0);
    this.crouch = expTo(this.crouch, f.dead ? 0 : crouchT, 22, dt);

    // Моргание: каждые несколько секунд глаза закрываются на долю секунды; у погибшего — закрыты
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkK = 0.14; this.blinkT = rand(2.2, 5.5); }
    this.blinkK = Math.max(0, this.blinkK - dt);
    const lid = f.dead ? 0.08 : this.blinkK > 0 ? 0.08 + 0.92 * Math.abs(this.blinkK - 0.07) / 0.07 : 1;
    for (const e of this.eyes) e.scale.y = lid;

    // Корень, падение, сальто
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.yaw;
    // Акробатика в ударах. От первого лица перевороты и развороты не делаем — иначе руки кружатся перед глазами
    let acroFlip = 0;
    const AT = f.attack, ACR = SP.acro || {};
    if (atk && AT) {
      if (SP.hop) this.root.position.y += Math.sin(Math.PI * clamp((ap - 0.35) / 0.65, 0, 1)) * 0.14 * SP.hop * this.scale;
      const sideOk = !ACR.sideOnly || isRightSide(AT.dir) || isLeftSide(AT.dir);
      if (!ctx.fp && AT.dir !== DIR.THRUST) {
        if (ACR.flipHeavy && AT.heavy) {
          // «Бросок ястреба-нетопыря»: прыжок с переворотом через голову и удар сверху
          acroFlip = -TAU * easeInOut(clamp((ap - 0.1) / 0.85, 0, 1));
          this.root.position.y += 0.75 * Math.sin(Math.PI * clamp((ap - 0.05) / 0.95, 0, 1)) * this.scale;
        } else if (ACR.spinCombo && sideOk && (AT.combo >= 1 || (ACR.spinHeavy && AT.heavy))) {
          this.root.rotation.y = f.yaw + TAU * easeInOut(clamp((ap - 0.15) / 0.8, 0, 1)) * (isLeftSide(AT.dir) ? 1 : -1);
        }
      }
      if (ACR.leapHeavy && AT.heavy) this.root.position.y += ACR.leapHeavy * Math.sin(Math.PI * clamp((ap - 0.15) / 0.85, 0, 1)) * this.scale;
    }
    // Уклонение у каждой формы своё (от первого лица — без переворотов)
    let acroRoll = 0;
    if (st === 'dodge' && !ctx.fp) {
      const k = clamp(f.stateT / f.dur, 0, 1), e = easeInOut(k), bell = Math.sin(Math.PI * k);
      const fw0 = fwdOf(f.yaw), rt0 = rightOf(f.yaw);
      const lx = f.vx * rt0.x + f.vz * rt0.z, lz = f.vx * fw0.x + f.vz * fw0.z, side = Math.abs(lx) > Math.abs(lz);
      const hop = h => { this.root.position.y += h * bell * this.scale; };
      switch (f.style) {
        case 'ataru':   // колесо вбок или сальто назад
          if (side) { acroRoll = -sign(lx) * TAU * e; hop(0.4); } else { acroFlip = (lz < 0 ? 1 : -1) * TAU * e; hop(0.55); }
          break;
        case 'niman':   // сальто с помощью Силы
          if (side) { acroRoll = -sign(lx) * TAU * e; hop(0.45); } else { acroFlip = (lz < 0 ? 1 : -1) * TAU * e; hop(0.5); }
          break;
        case 'juyo':    // пируэт
          this.root.rotation.y += TAU * e * (lx >= 0 ? -1 : 1); hop(0.12);
          break;
        case 'shii':    // кувырок по ходу уклонения
          if (side) acroRoll = -sign(lx) * TAU * e; else acroFlip = (lz < 0 ? 1 : -1) * TAU * e;
          this.root.position.y -= 0.35 * bell * this.scale;
          break;
        case 'makashi': hop(0.14); break;                                         // фехтовальный подскок
        case 'soresu': this.root.rotation.y += 0.9 * bell * (lx >= 0 ? -1 : 1); break;   // уход поворотом корпуса
      }
    }
    // Удар в прыжке: Атару и Джуйо — штопором, Джем-Со — переворот вперёд и обрушение сверху
    if (atk && AT && AT.dive && !ctx.fp) {
      const e = easeInOut(ap);
      if (f.style === 'ataru' || f.style === 'juyo') this.root.rotation.y += TAU * e;
      else if (f.style === 'djemso') acroFlip = -TAU * e;
    }
    // Вращение клинка с пируэтом (Атару, посох Джуйо): разворот вокруг себя с подскоком
    if (this.flourish && (this.flourish.type === 'pirouette' || this.flourish.type === 'staffSpin') && !ctx.fp) {
      const k = this.flourish.t / this.flourish.dur, e = easeInOut(clamp((k - 0.2) / 0.6, 0, 1));
      this.root.rotation.y = f.yaw + TAU * e;
      this.root.position.y += Math.sin(Math.PI * clamp((k - 0.2) / 0.6, 0, 1)) * 0.22 * this.scale;
    }
    // Отбив в момент блока: Атару отскакивает назад (мастерский блок — сальто назад), Макаши и Шии-Чо отступают
    const sinceB = time - f.blockFxT, pk = sinceB >= 0 && sinceB < 0.42 ? sinceB / 0.42 : -1;
    const pBell = pk >= 0 ? Math.sin(Math.PI * pk) * (f.blockFxPerfect ? 1.3 : 1) : 0;
    let parryStep = 0;
    if (pk >= 0) {
      if (f.style === 'ataru' && !ctx.fp) {
        const fw0 = fwdOf(f.yaw);
        this.root.position.x -= fw0.x * 0.35 * pBell * this.scale; this.root.position.z -= fw0.z * 0.35 * pBell * this.scale;
        this.root.position.y += (f.blockFxPerfect ? 0.45 : 0.18) * pBell * this.scale;
        if (f.blockFxPerfect) acroFlip = TAU * easeInOut(pk);
      }
      if (f.style === 'makashi' || f.style === 'shii') parryStep = 0.12 * pBell;
    }
    this.root.rotation.x = f.dead ? easeOut(Math.min(1, f.deathT * 2.2)) * 1.45 : 0;
    let fx = 0, fz = 0;
    if (st === 'roll') {
      // Перекат: кувырок вперёд у самой земли
      fx = -easeInOut(rollK) * TAU;
      this.root.position.y = f.y - 0.42 * Math.sin(Math.PI * rollK) * this.scale;
    }
    if (f.wallRun) {
      // Бег по стене: корпус наклонён к стене
      const rt0 = rightOf(f.yaw), nr = f.wallRun.nx * rt0.x + f.wallRun.nz * rt0.z;
      fz = nr * 0.45 * Math.min(1, f.wallRun.t * 8);
    }
    if (f.flip) {
      const k = easeInOut(flipK) * TAU;
      if (f.flip.type === 'front') fx = -k; else if (f.flip.type === 'back') fx = k;
      else if (f.flip.type === 'right') fz = -k; else fz = k;
    }
    // Атару и Джуйо крутят сальто с винтом
    if (f.flip && (f.style === 'ataru' || f.style === 'juyo') && !ctx.fp) this.root.rotation.y += TAU * easeInOut(flipK) * (f.index ? 1 : -1);
    this.flipG.rotation.set(fx + acroFlip, 0, fz + acroRoll);

    // Таз и корпус
    const mv = clamp(f.speed / 3.2, 0, 1) * (f.onGround || f.wallRun ? 1 : 0);
    let bob = f.onGround && !f.dead ? Math.abs(Math.cos(f.walkPhase)) * 0.025 * mv : 0;
    if (SP.bounce && f.onGround && !f.dead && st === 'idle') bob += (Math.sin(time * 6.5) * 0.5 + 0.5) * 0.035 * (1 - mv);   // Атару пружинит
    const lungeMul = (SP.lunge || 0) * (f.attack && f.attack.dir === DIR.THRUST ? (SP.acro && SP.acro.thrustLunge || 1) : 1);
    const fwdShift = lungeMul * 0.26 * LK + (SP.stepIn || 0) * LK;
    B.hips.position.set(this.rest.hips.x, this.rest.hips.y - this.crouch * 0.3 - bob, this.rest.hips.z + this.crouch * 0.04 - fwdShift + parryStep);
    B.hips.rotation.set(-this.crouch * 0.2 - this.tuck * 0.35, Math.sin(f.walkPhase) * 0.08 * mv, 0);

    let lean = -0.04 - this.crouch * 0.28 - (SP.lean || 0), twist = 0;
    if (atk && f.attack) {
      const dir = f.attack.dir, side = isRightSide(dir) ? 1 : isLeftSide(dir) ? -1 : 0;
      const k = st === 'windup' ? clamp(f.stateT / f.dur, 0, 1) : 1;
      twist = (st === 'windup' ? -0.4 * side * k : 0.35 * side) * (SP.twist || 1);
      lean += st === 'strike' ? -0.16 : (dir === DIR.UP ? 0.06 : -0.04) * k;
      if (SP.raise && st === 'windup' && dir !== DIR.THRUST) lean += 0.12 * k * SP.raise;   // Джем-Со: прогиб назад на замахе
      if (stompK) lean -= 0.22 * stompK;                                                    // и всем весом вниз в удар
    }
    twist += SP.profile || 0;                              // Соресу: корпус всегда вполоборота
    if (pBell) {
      if (f.style === 'djemso') lean -= 0.22 * pBell;      // отбив всем весом вперёд
      if (f.style === 'soresu') twist += 0.6 * pBell;      // разворот-уклон корпусом
      if (f.style === 'juyo') twist += 0.55 * pBell * (f.index ? 1 : -1);
    }
    const sinceH = time - f.hitFxT;
    if (sinceH >= 0 && sinceH < 0.4) { const hb = Math.sin(Math.PI * sinceH / 0.4); twist += 0.6 * hb * f.hitFxSide; lean += 0.12 * hb; }
    lean -= 0.14 * LK * (SP.lunge || 0);
    if (st === 'stagger') lean += 0.28 * Math.sin(Math.PI * clamp(f.stateT / f.dur, 0, 1));
    if (st === 'dodge') lean -= 0.1;
    if (st === 'kick') lean += 0.2 * Math.sin(Math.PI * clamp(f.stateT / f.dur, 0, 1));
    lean -= 0.45 * this.tuck;
    lean += 0.07 * this.airK * (f.vy > 0 ? 1 : 0);
    const mk = f.dur ? clamp(f.stateT / f.dur, 0, 1) : 0;
    if (st === 'hang') lean = 0.1;
    if (st === 'climb') lean = -0.6 * Math.sin(Math.PI * clamp((mk - 0.2) / 0.65, 0, 1));
    if (st === 'vault') lean = -0.4 * Math.sin(Math.PI * mk);
    if (f.dead) lean = 0;
    this.lean = expTo(this.lean, lean, 14, dt);
    this.twist = expTo(this.twist, twist, 14, dt);
    B.spine.rotation.set(this.lean * 0.45, this.twist * 0.4, 0);
    B.chest.rotation.set(this.lean * 0.55, this.twist * 0.6, 0);
    const look = clamp(ctx.pitch || 0, -0.7, 0.6);
    B.neck.rotation.set(0.4 * (look - this.lean), -this.twist * 0.4, 0);
    B.head.rotation.set(0.6 * (look - this.lean), -this.twist * 0.6, 0);
    this.root.updateMatrixWorld(true);

    // Ноги
    this.modelG.getWorldQuaternion(_qm);
    const fw = fwdOf(f.yaw), rt = rightOf(f.yaw);
    const vf = f.vx * fw.x + f.vz * fw.z, vs = f.vx * rt.x + f.vz * rt.z, sp = Math.hypot(vf, vs) || 1;
    const dX = vs / sp, dZ = -vf / sp, ph = f.walkPhase;
    for (const S of ['R', 'L']) {
      const sg = S === 'R' ? 1 : -1, off = sg > 0 ? 0 : Math.PI;
      const fs = SP.stance || [0.13, -0.08, -0.12, 0.1];
      const st0 = sg > 0 ? [fs[0], fs[1]] : [fs[2], fs[3]];
      const bx = lerp(st0[0], sg * 0.11, mv) * (1 + this.crouch * 0.35), bz = lerp(st0[1], 0, mv);
      const sw = Math.sin(ph + off), lift = Math.max(0, Math.cos(ph + off));
      const ground = [bx + dX * sw * 0.24 * mv, 0.085 + lift * 0.12 * mv, bz + dZ * sw * 0.24 * mv];
      // Выпад (Макаши) и шаг в удар (Шии-Чо): передняя нога вперёд, задняя отставлена
      const step = lungeMul * 0.42 + (SP.stepIn || 0) * 1.8;
      if (step && LK > 0) ground[2] += (sg > 0 ? -step : step * 0.35) * LK;
      const rising = sg > 0 ? [0.11, 0.48, -0.22] : [-0.11, 0.3, 0.14];
      const falling = [sg * 0.12, 0.2, sg > 0 ? -0.1 : 0.06];
      const airP = lerp3(falling, rising, clamp(f.vy / 4, 0, 1));
      const tuckP = [sg * 0.09, 0.62, -0.14];
      let foot = lerp3(ground, lerp3(airP, tuckP, this.tuck), this.airK);
      if (st === 'hang') foot = [sg * 0.1, 0.1 + Math.sin(time * 1.6 + sg) * 0.02, -0.06];
      if (st === 'climb') {
        const ledgeY = f.mantle ? (f.mantle.ty - f.y) / s : 1;
        if (sg > 0 && mk > 0.32 && mk < 0.8) foot = [0.1, clamp(ledgeY + 0.1, 0.1, 1.2), -0.32];
        else if (mk < 0.75) foot = [sg * 0.1, 0.1, -0.04];
        else foot = [sg * 0.11, 0.085, sg > 0 ? -0.06 : 0.06];
      }
      if (st === 'vault') { const k = Math.sin(Math.PI * mk); foot = lerp3(ground, [0.16 + sg * 0.07, 0.48, -0.05], k); }
      if (st === 'kick' && sg > 0) {
        // Пинок правой: колено вверх, затем выброс стопы вперёд на уровне пояса
        const t = clamp(f.stateT / f.dur, 0, 1);
        const up = Math.sin(Math.PI * Math.min(1, t / 0.75));
        const out = t < 0.36 ? t / 0.36 : Math.max(0, 1 - (t - 0.36) / 0.4);
        foot = lerp3(ground, lerp3([0.1, 0.55, -0.25], [0.08, 0.92, -0.6], out), up);
      }
      _t.set(foot[0], foot[1], foot[2]);
      const target = this.modelG.localToWorld(_t.clone());
      const pole = new THREE.Vector3(sg * 0.15, this.tuck * 0.5, -1).applyQuaternion(_qm);
      this.twoBone(B['thigh' + S], B['shin' + S], B['foot' + S], target, pole);
      // Стопа ровно, в воздухе носок вниз
      B['shin' + S].getWorldQuaternion(_q1);
      _q2.setFromAxisAngle(_a.set(1, 0, 0), (this.airK * 0.5 + (hanging ? 0.6 : 0)));
      B['foot' + S].quaternion.copy(_q1.invert()).multiply(_qm).multiply(_q2);
      B['foot' + S].updateMatrixWorld(true);
    }

    // Руки: правая ведёт клинок, левая — на рукояти или занята уступом/балансом
    // Вращение клинка по кнопке G: длится, пока боец спокойно стоит; удар, блок или прыжок его прерывают
    {
      const def = flourishOf(f), since = time - f.flourishAt;
      if (since >= 0 && since < def[1] && st === 'idle' && !f.blocking && !f.dead && !f.disarm && f.onGround) this.flourish = { type: def[0], dur: def[1], t: since };
      else this.flourish = null;
    }
    const W = f.weapon || 'single', freeLeft = W === 'single' || W === 'reverse';
    const pose0 = this.poseAnim.update(f, time, dt);
    let pose = this.overlay(f, pose0, time, ap, false), poseL = null;
    if (W === 'dual') {
      // Два клинка: в связке удары чередуются — нечётный бьёт левая рука, правая держит защиту
      const guard = targetPose(Object.assign({}, f, { state: 'idle' }), time);
      const leftAtk = (atk || st === 'recover') && f.attack && f.attack.combo % 2 === 1;
      const tR = leftAtk ? guard : pose0, tL = mirrorPose(leftAtk ? pose0 : guard);
      const kk = 1 - Math.exp(-28 * dt);
      this.dualR = this.dualR ? smoothPose(this.dualR, tR, kk) : tR;
      this.dualL = this.dualL ? smoothPose(this.dualL, tL, kk) : tL;
      pose = this.overlay(f, this.dualR, time, ap, false);
      poseL = this.overlay(f, this.dualL, time, ap, true);
    }
    const E0 = _e.set(J.eye[0] - J.chest[0], J.eye[1] - J.chest[1], J.eye[2] - J.chest[2]);
    const e0x = E0.x, e0y = E0.y, e0z = E0.z;
    const toWorld = p => B.chest.localToWorld(new THREE.Vector3(e0x + p.h[0] * 0.95, e0y + p.h[1], e0z + p.h[2] * 0.8));
    const handR = toWorld(pose);
    B.chest.getWorldQuaternion(_q1);
    const bladeDir = new THREE.Vector3(pose.d[0], pose.d[1], pose.d[2]).applyQuaternion(_q1);
    const bladeDirL = poseL ? new THREE.Vector3(poseL.d[0], poseL.d[1], poseL.d[2]).applyQuaternion(_q1) : null;
    let handL = W === 'staff' ? handR.clone().addScaledVector(bladeDir, -0.24 * s)
      : W === 'dual' ? toWorld(poseL)
      : W === 'reverse' ? B.chest.localToWorld(new THREE.Vector3(-0.26, -0.12, -0.26))
      : handR.clone().addScaledVector(bladeDir, -0.1 * s);
    let rightT = handR, leftT = handL;
    const rtv = new THREE.Vector3(rt.x, 0, rt.z);
    if ((hanging || st === 'vault') && f.ledge) {
      const L = f.ledge;
      const edge = new THREE.Vector3(L.ex - L.nx * 0.04, L.top + 0.02, L.ez - L.nz * 0.04);
      const eR = edge.clone().addScaledVector(rtv, 0.17 * s), eL = edge.clone().addScaledVector(rtv, -0.17 * s);
      if (st === 'vault') leftT = eL.lerp(handL, clamp((mk - 0.55) / 0.4, 0, 1));
      else {
        const rel = st === 'climb' ? clamp((mk - 0.72) / 0.28, 0, 1) : 0;
        rightT = eR.lerp(handR, rel); leftT = eL.lerp(handL, rel);
      }
    } else if (freeLeft && !atk && !f.dead && st !== 'bind') {
      // В воздухе левая рука отпускает рукоять для равновесия, в группировке — хватает колено
      const bal = B.chest.localToWorld(new THREE.Vector3(-0.42, -0.02, -0.12));
      leftT = handL.clone().lerp(bal, this.airK * (1 - this.tuck));
      const knee = B.shinL.getWorldPosition(new THREE.Vector3()).addScaledVector(bladeDir, 0).add(new THREE.Vector3(0, 0.02 * s, 0));
      leftT.lerp(knee, this.tuck);
    }
    // Ниман: свободная рука — для Силы: раскрытая ладонь вперёд, в ударе выбрасывается к сопернику
    if (freeLeft && SP.forceHand && !hanging && st !== 'vault' && st !== 'bind' && st !== 'push' && st !== 'pull' && !f.dead) {
      const rest = B.chest.localToWorld(new THREE.Vector3(-0.34, -0.06, -0.3));
      const cast = B.chest.localToWorld(new THREE.Vector3(-0.16, 0.08, -0.58));
      const hand = rest.lerp(cast, Math.max(atk ? Math.sin(Math.PI * ap) : 0, pBell));
      leftT = leftT.clone().lerp(hand, 1 - this.airK * (1 - this.tuck));
    }
    // Во время вращения свободная рука отпускает рукоять (у Нимана — ладонь вперёд)
    if (this.flourish && W !== 'dual') {
      const F = this.flourish, k = F.t / F.dur, w = smooth01(k / 0.14) * (1 - smooth01((k - 0.84) / 0.16));
      const behind = W === 'staff' || W === 'reverse';   // у посоха и обратного хвата рука уходит за бедро, подальше от лезвий
      const free = F.type === 'palm' ? B.chest.localToWorld(new THREE.Vector3(-0.18, 0.06, -0.56))
        : behind ? B.chest.localToWorld(new THREE.Vector3(-0.28, -0.36, 0.14)) : B.chest.localToWorld(new THREE.Vector3(-0.3, -0.24, -0.12));
      leftT = leftT.clone().lerp(free, w);
    }
    // Макаши: клинок в одной руке, свободная рука за спиной
    if (freeLeft && SP.oneHand && !hanging && st !== 'vault' && st !== 'bind' && st !== 'push' && st !== 'pull' && !f.dead) {
      const behind = B.spine.localToWorld(new THREE.Vector3(-0.1, -0.05, 0.16));
      leftT = leftT.clone().lerp(behind, 1 - this.airK * (1 - this.tuck));
    }
    if (st === 'pull') {
      // Рука тянется к выбитому клинку
      const D = f.disarm;
      const target = D ? new THREE.Vector3(D.x, D.y + 0.2, D.z) : B.chest.localToWorld(new THREE.Vector3(-0.1, 0.1, -0.6));
      const reach = B.chest.localToWorld(new THREE.Vector3(-0.1, 0.05, -0.55));
      const dir = target.sub(B.chest.getWorldPosition(new THREE.Vector3())).normalize();
      leftT = B.chest.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6 * s).lerp(reach, 0.3);
      leftT.y += 0.12 * s;
    }
    if (st === 'push') {
      // Левая рука выбрасывается вперёд раскрытой ладонью
      const k = clamp(f.stateT / CFG.PUSH_WINDUP, 0, 1), back = 1 - clamp((f.stateT - CFG.PUSH_WINDUP) / 0.25, 0, 1);
      const cocked = B.chest.localToWorld(new THREE.Vector3(-0.2, 0.0, -0.15));
      const thrust = B.chest.localToWorld(new THREE.Vector3(-0.08, 0.1, -0.6));
      leftT = k < 1 ? cocked.lerp(thrust, k * k) : thrust.lerp(handL, 1 - back);
    }
    if (f.dead) {
      rightT = B.chest.localToWorld(new THREE.Vector3(0.28, -0.42, -0.06));
      leftT = B.chest.localToWorld(new THREE.Vector3(-0.28, -0.42, -0.06));
    }
    for (const S of ['R', 'L']) {
      const sg = S === 'R' ? 1 : -1;
      const pole = new THREE.Vector3(sg * 0.6, -1, 0.35).applyQuaternion(_qm);
      if (hanging) pole.set(sg * 0.8, -0.3, 0.5).applyQuaternion(_qm);
      this.twoBone(B['upperArm' + S], B['foreArm' + S], B['hand' + S], S === 'R' ? rightT : leftT, pole);
    }

    // Клинок в правой кисти, а если выбит — лежит на земле (или летит)
    if (f.disarm) {
      const D = f.disarm;
      this.blade.group.position.set(D.x, D.y, D.z);
      const spin = D.landed ? 0 : D.t * 14;
      this.blade.group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.cos(spin + D.vx), D.landed ? 0.04 : Math.sin(spin), Math.sin(spin + D.vz)).normalize());
      this.blade.group.visible = !D.lost && this.visible;
    } else {
      const grip = B.handR.localToWorld(new THREE.Vector3(J.armDirR[0] * 0.05, J.armDirR[1] * 0.05, J.armDirR[2] * 0.05));
      const dn = bladeDir.normalize();
      if (W === 'staff') {
        // Посох: общая рукоять между кистями, лезвия в обе стороны
        const c = grip.clone().addScaledVector(dn, -0.12 * s * (1 - (this.flW || 0)));   // при вращении хват плавно уходит на середину
        this.blade.group.position.copy(c).addScaledVector(dn, 0.03);
        this.blade.group.quaternion.setFromUnitVectors(UP, dn);
      } else if (W === 'reverse') {
        // Обратный хват: клинок выходит снизу кулака
        this.blade.group.position.copy(grip);
        this.blade.group.quaternion.setFromUnitVectors(UP, dn.clone().negate());
      } else {
        this.blade.group.position.copy(grip);
        this.blade.group.quaternion.setFromUnitVectors(UP, dn);
      }
      this.blade.group.visible = this.visible;
    }
    // Второй клинок: левая рука (два клинка) или нижнее лезвие посоха
    const need2 = (W === 'staff' || W === 'dual') && !f.disarm;
    if (need2 && !this.blade2) { this.blade2 = new Blade(this.bladeColor, this.scene); this.scene.add(this.blade2.group); }
    if (this.blade2) {
      this.blade2.used = need2;
      this.blade2.group.visible = need2 && this.visible;
      if (need2) {
        if (W === 'staff') {
          const dn = bladeDir.clone().normalize();
          const grip = B.handR.localToWorld(new THREE.Vector3(J.armDirR[0] * 0.05, J.armDirR[1] * 0.05, J.armDirR[2] * 0.05));
          this.blade2.group.position.copy(grip).addScaledVector(dn, -0.12 * s * (1 - (this.flW || 0)) - 0.03);
          this.blade2.group.quaternion.setFromUnitVectors(UP, dn.negate());
        } else {
          const gripL = B.handL.localToWorld(new THREE.Vector3(J.armDirL[0] * 0.05, J.armDirL[1] * 0.05, J.armDirL[2] * 0.05));
          this.blade2.group.position.copy(gripL);
          this.blade2.group.quaternion.setFromUnitVectors(UP, bladeDirL.clone().normalize());
        }
        this.blade2.setIgnite(f.ignite);
        this.blade2.group.updateMatrixWorld(true);
        if (this.visible) this.blade2.sampleTrail(this.poseAnim.speed * 1.1);
      } else this.blade2.trail.reset();
    }
    this.blade.setIgnite(f.ignite);
    this.blade.group.updateMatrixWorld(true);
    if (this.visible) this.blade.sampleTrail(this.poseAnim.speed);

    // Ткань
    const cdt = Math.min(dt, 1 / 30);
    if (cdt > 0 && this.visible) {
      const cols = this.colliders();
      const floorY = f.onGround ? f.y : -50;
      for (const c of this.cloth) c.step(cdt, cols, floorY);
      if (this.rope) this.rope.step(cdt, cols);
    }
  }

  resetCloth() { for (const c of this.cloth) c.needReset = true; if (this.rope) this.rope.needReset = true; }
}
const FWD_POLE = new THREE.Vector3(0, 0, -1), BACK_POLE = new THREE.Vector3(0, 0, 1);
