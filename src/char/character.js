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
// ---------- Лезвие не проходит сквозь своё тело ----------
const _cp = new THREE.Vector3(), _pt = new THREE.Vector3(), _ab = new THREE.Vector3();
function closestOnSeg(p, a, b, out) {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq(), t = l2 > 1e-9 ? clamp(_cp.subVectors(p, a).dot(_ab) / l2, 0, 1) : 0;
  return out.copy(a).addScaledVector(_ab, t);
}
// Отводим направление лезвия наружу, пока оно касается капсул тела. from — откуда начинается свечение, len — его длина.
function clearBladeDir(grip, dir, caps, from = 0.2, len = 1.15) {
  const b = dir.clone().normalize(), c = new THREE.Vector3();
  for (let it = 0; it < 16; it++) {
    let worst = 0, wt = 0; const wp = new THREE.Vector3(), wc = new THREE.Vector3();
    for (let t = from; t <= len + 1e-6; t += 0.07) {
      _pt.copy(grip).addScaledVector(b, t);
      for (const C of caps) {
        closestOnSeg(_pt, C.p, C.q, c);
        const pen = C.r + 0.03 - _pt.distanceTo(c);
        if (pen > worst) { worst = pen; wt = t; wp.copy(_pt); wc.copy(c); }
      }
    }
    if (worst <= 0) break;
    const push = wp.sub(wc);
    if (push.lengthSq() < 1e-8) push.set(0, 1, 0);
    b.addScaledVector(push.normalize(), worst / Math.max(wt, 0.2) * 1.3 + 0.03).normalize();
  }
  return b;
}
// Ближайшие точки двух отрезков (p1-q1 и p2-q2): возвращает [точка на первом, точка на втором, расстояние]
function segSegClosest(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
    s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return [c1, c2, c1.distanceTo(c2)];
}
// Отрезок светящейся части клинка в мировых координатах
function bladeSegOf(B0, ignite) {
  B0.group.updateMatrixWorld(true);
  return [new THREE.Vector3(0, 0.25, 0).applyMatrix4(B0.group.matrixWorld), new THREE.Vector3(0, 0.21 + CFG.BLADE_LEN * Math.max(ignite, 0.01), 0).applyMatrix4(B0.group.matrixWorld)];
}
// Тёплое подповерхностное свечение кожи: красноватая доля цвета кожи
const skinScreen = hex => { const c = new THREE.Color(hex); c.r = Math.min(1, Math.pow(c.r, 1.75) * 1.12); c.g = Math.min(1, Math.pow(c.g, 1.75) * 1.12); c.b = Math.min(1, Math.pow(c.b, 1.75) * 1.12); return c; };   // как skinTone в chargen
const skinGlow = hex => skinScreen(hex).multiply(new THREE.Color(1, 0.62, 0.5)).multiplyScalar(0.09);
const mirrorPose = p => ({ h: [-p.h[0], p.h[1], p.h[2]], d: [-p.d[0], p.d[1], p.d[2]] });
const smoothPose = (cur, tgt, k) => ({ h: lerp3(cur.h, tgt.h, k), d: norm3(lerp3(cur.d, tgt.d, k)) });
// Как форма отбивает удар в момент блока
const PARRY = { shii: 'down', makashi: 'circle', soresu: 'roll', ataru: 'hop', djemso: 'beat', niman: 'palm', juyo: 'flick' };
// Вращение клинка (кнопка G): у каждого оружия своё, у одиночного клинка — своё для каждой формы
const FLOURISH_SINGLE = { shii: ['wide', 1.3], makashi: ['salute', 1.6], soresu: ['eight', 1.2], ataru: ['pirouette', 1.2], djemso: ['heli', 1.4], niman: ['palm', 1.3], juyo: ['zigzag', 1.0] };
function flourishOf(f) {
  if (f.weapon === 'staff') return f.style === 'ataru' || f.style === 'juyo' ? ['staffSpin', 1.6] : ['staff', 1.5];
  if (f.weapon === 'dual') return ['dual', 1.4];
  if (f.weapon === 'reverse') return ['reverseFlip', 1.3];
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
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0102, 16, 12), eyeMat);
      this.eyes.push(e);
      e.position.set(0.032 * s, J.eyeLocal[1], -0.0728);
      this.fpMeshes.push(e);
      this.bones.head.add(e);
    }
    // Веки: закрывают верх и низ глазного яблока — разрез миндалевидный, а не круглые «кукольные» глаза
    const lidMat = new THREE.MeshStandardMaterial({ color: skinScreen(look.skin), roughness: 0.74, emissive: skinGlow(look.skin) });   // цвета кожи — без тёмных ободков
    this.meshes.push(lidMat);
    this.lids = [];
    for (const s of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.SphereGeometry(0.0111, 16, 8, 0, TAU, 0, 1.12), lidMat);
      const lo = new THREE.Mesh(new THREE.SphereGeometry(0.0109, 16, 6, 0, TAU, Math.PI - 1.0, 1.0), lidMat);
      for (const lid of [up, lo]) {
        lid.position.set(0.032 * s, J.eyeLocal[1], -0.0728);
        this.fpMeshes.push(lid); this.bones.head.add(lid); this.lids.push(lid);
      }
      up.rotation.x = -0.12;   // верхнее веко чуть надвинуто вперёд
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
      // Кожа: цвета вершин (неровность тона, румянец, костяшки), без пластикового блеска,
      // и лёгкое тёплое свечение изнутри — простая имитация света, рассеянного под кожей
      head: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, emissive: skinGlow(look.skin) }),
      skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, emissive: skinGlow(look.skin) }),
      hair: std(look.hairColor, 0.55, 0.05, THREE.FrontSide, false),
      hairV: std(look.hairColor, 0.62, 0.04),   // волосы и борода с прядями (цвета вершин)
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
          cols: 7, rows: 9, material: this.mats.tunicCloth, stiff: 0.4, collide: ['leg', 'hip'],
          rest: (i, j) => {
            const t = j / 8, w = side < 0 ? 0.11 : 0.13, u = i / 6;
            const fold = Math.sin(u * Math.PI * 3) * 0.022 * t;     // складки по ширине, глубже книзу
            const len = 0.43 * (1 - 0.12 * (2 * u - 1) ** 2);       // край закруглён: углы короче середины
            return [lerp(-w, w, u) * lerp(0.88, 1.15, t), 0.965 - t * len, side * (fz + 0.005 + t * 0.02 + fold + 0.02 * Math.sin(u * Math.PI) * t)];
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
      const cols = 15, rows = 13;
      this.cloth.push(new ClothPanel(this, {
        cols, rows, material: this.mats.outerCloth, stiff: 0.45, collide: ['leg', 'hip', 'torso', 'arm', 'head'],
        rest: (i, j) => {
          // Верх плаща — дуга вокруг шеи от плеча до плеча (под пелериной), книзу расходится складками,
          // край неровный
          const u = i / (cols - 1), t = j / (rows - 1), phi = lerp(-1.75, 1.75, u);
          const tx = Math.sin(phi) * 0.19 * m, ty = 1.44 - 0.04 * Math.abs(Math.sin(phi)), tz = 0.03 + Math.cos(phi) * 0.12;
          const fold = Math.sin(u * Math.PI * 6) * 0.028 * t;
          const len = 1.12 + 0.05 * Math.sin(u * Math.PI * 3 + 0.7);
          return [tx * (1 + t * 0.55), ty - t * len, tz + t * 0.1 + fold + 0.05 * (1 - (2 * u - 1) ** 2) * t];
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
    if (this.ember) { this.scene.remove(this.ember); this.ember.geometry.dispose(); this.ember.material.dispose(); }
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

  // Клинки встречаются по-настоящему: в блоке и в момент отбива лезвие доводится до клинка противника,
  // а у атакующего, чей удар приняли, — до клинка защиты. oppBlades — отрезки клинков противника с прошлого кадра.
  interceptDir(f, grip, dn, time) {
    const opp = this.oppBlades;
    if (!opp || !opp.length || f.dead) return dn;
    const sinceB = time - f.blockFxT;
    let w = 0;
    if (f.blocking) w = 0.55;
    if (sinceB >= 0 && sinceB < 0.3) w = Math.max(w, Math.min(1, Math.sin(Math.PI * (0.15 + sinceB) / 0.45) * 1.2));
    if (f.state === 'strike' && f.attack && f.attack.blocked) w = Math.max(w, 0.8 * (1 - clamp(f.stateT / 0.15, 0, 1)));
    if (w <= 0) return dn;
    const tip = grip.clone().addScaledVector(dn, 1.1 * this.scale);
    let best = null;
    for (const [a, b] of opp) {
      const [, onOpp, d] = segSegClosest(grip, tip, a, b);
      if (d < 1.3 && (!best || d < best.d)) best = { p: onOpp, d };
    }
    if (!best) return dn;
    const to = best.p.clone().sub(grip), L = to.length();
    if (L < 0.25 * this.scale) return dn;   // точка встречи дальше длины клинка — тянемся к ней направлением
    to.divideScalar(L);
    const q = new THREE.Quaternion().setFromUnitVectors(dn, to);
    return dn.clone().applyQuaternion(new THREE.Quaternion().slerp(q, w)).normalize();
  }

  // Капсулы тела в мировых координатах (после IK рук). skip — какие кости не учитывать (рука, держащая клинок)
  bodyCaps(skip) {
    const B = this.bones, s = this.scale, w = n => B[n].getWorldPosition(new THREE.Vector3());
    const head = w('head'), top = head.clone(); top.y += 0.13 * s;
    const caps = [
      { p: w('hips'), q: w('neck'), r: 0.17 * s },
      { p: head, q: top, r: 0.12 * s },
      { p: w('thighR'), q: w('shinR'), r: 0.09 * s }, { p: w('thighL'), q: w('shinL'), r: 0.09 * s },
      { p: w('shinR'), q: w('footR'), r: 0.07 * s }, { p: w('shinL'), q: w('footL'), r: 0.07 * s },
    ];
    // Плечо учитываем всегда; предплечье и кисть руки, держащей клинок, — нет (лезвие растёт из неё)
    caps.push({ p: w('clavL'), q: w('foreArmL'), r: 0.065 * s }, { p: w('clavR'), q: w('foreArmR'), r: 0.065 * s });
    if (!(skip || '').includes('L')) caps.push({ p: w('foreArmL'), q: w('handL'), r: 0.05 * s });
    if (!(skip || '').includes('R')) caps.push({ p: w('foreArmR'), q: w('handR'), r: 0.05 * s });
    return caps;
  }

  // Обратный хват: компактные удары кулаком, клинок вдоль внешней стороны предплечья
  reversePose(f, pose, ap) {
    if (this.flourish && this.flW > 0.5) return pose;   // во время вращения направление задано самим вращением
    const st = f.state, atk = st === 'windup' || st === 'strike';
    let h = [lerp(pose.h[0], 0.2, 0.25), Math.max(lerp(pose.h[1], -0.2, 0.3), -0.3), lerp(pose.h[2], -0.36, 0.3)];   // кулак не ниже пояса — лезвию есть куда уйти
    if (atk) h[2] -= 0.14 * Math.sin(Math.PI * ap);                 // удар — как выброс кулака
    // Желаемое направление: назад вдоль предплечья и наружу от тела
    const sh = [0.19, -0.24, 0.07], fa = norm3([h[0] - sh[0], h[1] - sh[1], h[2] - sh[2]]);
    const out = norm3([h[0], 0, h[2] - 0.05]);
    let b = norm3([-pose.d[0] * 0.55 - fa[0] * 0.45 + out[0] * 0.5, -pose.d[1] * 0.55 - fa[1] * 0.45 - 0.1, -pose.d[2] * 0.55 - fa[2] * 0.45 + out[2] * 0.5]);
    // Удар обратным хватом по ключевым положениям: замах — лезвие взведено назад над плечом,
    // удар — кулак идёт поперёк тела, лезвие широкой дугой режет перед собой, проводка — уходит за другое плечо
    if ((atk || st === 'recover') && f.attack) {
      const dir = f.attack.dir, sd = isLeftSide(dir) ? -1 : 1, low = isLow(dir) ? 1 : 0;
      let B0, B1, B2, H0, H1;
      if (dir === DIR.UP) { B0 = [0.2, 0.75, 0.6]; B1 = [0.1, -0.2, -0.97]; B2 = [0.05, -0.85, 0.5]; H0 = [0.24, 0.02, -0.26]; H1 = [0.1, -0.32, -0.46]; }
      else if (dir === DIR.THRUST) { B0 = [0.3, 0.6, 0.7]; B1 = [0.1, -0.35, -0.93]; B2 = [0.2, -0.8, -0.4]; H0 = [0.26, -0.08, -0.22]; H1 = [0.08, -0.22, -0.6]; }
      else {
        B0 = [0.55 * sd, 0.35 - 0.5 * low, 0.75]; B1 = [-0.7 * sd, -0.15 - 0.35 * low, -0.6]; B2 = [-0.75 * sd, -0.3 - 0.3 * low, 0.55];
        H0 = [0.36 * sd, -0.12 - 0.12 * low, -0.28]; H1 = [-0.18 * sd, -0.28 - 0.1 * low, -0.42];
      }
      const slerp3 = (a, c, t) => { const A = new THREE.Vector3(...norm3(a)), C = new THREE.Vector3(...norm3(c)); const q = new THREE.Quaternion().setFromUnitVectors(A, C); return A.applyQuaternion(new THREE.Quaternion().slerp(q, t)).toArray(); };
      let bb, hh;
      if (st === 'recover') {
        const r = smooth01(f.stateT / f.dur);
        bb = r < 0.35 ? slerp3(B1, B2, r / 0.35) : slerp3(B2, b, (r - 0.35) / 0.65);
        hh = lerp3(H1, h, r);
      } else if (ap < 0.55) {
        const w = smooth01(ap / 0.55);
        bb = slerp3(b, B0, w); hh = lerp3(h, H0, w);
      } else {
        const w = easeInOut(clamp((ap - 0.55) / 0.45, 0, 1));
        bb = slerp3(B0, B1, w); hh = lerp3(H0, H1, w);
      }
      return { h: hh, d: norm3(bb) };
    }
    // Блок: своё положение для каждой стороны креста
    if (f.blocking && st === 'idle') {
      const BL = [
        { h: [0.16, 0.0, -0.36], d: [-0.92, 0.12, 0.25] },     // сверху: кулак над головой, лезвие поперёк
        { h: [0.32, -0.1, -0.3], d: [0.2, -0.9, 0.3] },        // справа: лезвие вертикально вдоль правого бока
        { h: [0.26, -0.3, -0.36], d: [0.35, -0.85, -0.3] },    // снизу справа: вниз перед бедром
        { h: [-0.1, -0.3, -0.38], d: [-0.4, -0.85, -0.25] },   // снизу слева
        { h: [-0.18, -0.1, -0.34], d: [-0.2, -0.9, 0.3] },     // слева: вертикально вдоль левого бока
      ][f.stance] || null;
      if (BL) return { h: BL.h, d: norm3(BL.d) };
    }
    // В стойке — заданные направления по сторонам креста: лезвие вдоль предплечья наружу и назад
    if (st === 'idle' && !f.blocking && !this.flourish) {
      const G = [[0.5, 0.25, 0.8], [0.8, -0.1, 0.55], [0.75, -0.5, 0.42], [-0.35, -0.85, -0.35], [-0.8, -0.25, -0.2]][f.stance] || [0.8, -0.1, 0.55];
      return { h, d: norm3([lerp(b[0], G[0], 0.75), lerp(b[1], G[1], 0.75), lerp(b[2], G[2], 0.75)]) };
    }
    return { h, d: b };   // d здесь — уже направление лезвия (не разворачивать)
  }

  // ---------- Добивания: сценка проигравшего ----------
  // Возвращает смещения корня, наклоны, присед на колени и цели рук
  deathAnim(f, time) {
    const fin = f.fin && f.fin.role === 'victim' ? f.fin : null;
    const type = fin ? fin.type : 'generic', k = fin ? time - fin.t0 : f.deathT;
    const D = { rotX: 0, rotZ: 0, yaw: 0, dy: 0, kneel: 0, lean: 0, slide: 0, slideBack: 0, spread: 0, armR: null, armL: null, handGone: false };
    const sm = (a, b) => smooth01((k - a) / (b - a));
    const hang = [0.22, -0.46, 0.02];
    // Падение под тяжестью: разгоняется к земле, чуть пружинит при ударе и замирает
    const fall = (a, b, target) => {
      if (k < a) return 0;
      if (k < b) { const u = (k - a) / (b - a); return target * u * u; }
      const t = k - b; return target + target * 0.06 * Math.sin(Math.PI * clamp(t / 0.22, 0, 1)) * Math.exp(-t * 5);
    };
    const arms = (r, l) => { D.armR = r; D.armL = l; };
    const mixA = (a, b, t) => lerp3(a, b, clamp(t, 0, 1));
    // Навзничь: колени подламываются, корпус прогибается назад, руки взлетают, тело валится и ложится
    const backFall = t0 => {
      const buckle = sm(t0, t0 + 0.4);
      D.kneel = 0.55 * buckle - 0.25 * sm(t0 + 0.5, t0 + 0.9);
      D.lean = -0.45 * buckle;
      D.rotX = fall(t0 + 0.25, t0 + 0.8, 1.5);
      D.dy = -0.12 * sm(t0 + 0.6, t0 + 0.85);
      D.spread = 0.08 * sm(t0 + 0.6, t0 + 1.0);
      const up = [0.42, 0.12, 0.12], ground = [0.5, -0.06, 0.1];
      const a = mixA(mixA(hang, up, sm(t0, t0 + 0.35)), ground, sm(t0 + 0.6, t0 + 1.0));
      arms(a, [-a[0], a[1], a[2]]);
    };
    // Вперёд с колен: корпус клонится, руки выставлены вперёд, ложится на согнутые руки
    const forwardFall = (t0, kneelAt) => {
      D.kneel = sm(kneelAt, kneelAt + 0.55);
      D.lean = 0.25 * D.kneel + 0.3 * sm(t0, t0 + 0.4);
      D.rotX = -fall(t0 + 0.15, t0 + 0.65, 1.42);
      D.dy = -0.1 * sm(t0 + 0.45, t0 + 0.7);
      const catchA = [0.25, -0.2, -0.45], ground = [0.34, 0.06, -0.34];
      const a = mixA(mixA(hang, catchA, sm(t0, t0 + 0.3)), ground, sm(t0 + 0.55, t0 + 0.9));
      arms(a, [-a[0], a[1], a[2]]);
    };
    switch (type) {
      case 'kneel':     // обмяк, на колени, заваливается вперёд
        forwardFall(0.95, 0); break;
      case 'impale':    // пронзён: замирает на клинке, оседает, падает вперёд
        D.slide = 1;
        forwardFall(1.45, 0.9);
        if (k < 1.0) arms([0.16, -0.18, -0.32], [-0.16, -0.18, -0.32]);   // тянется к клинку
        D.lean += -0.15 * (1 - sm(0.3, 0.9)) * sm(0, 0.3);
        break;
      case 'hand': {    // кисть отсечена: хватается за запястье, на колени, падает на бок
        D.handGone = true;
        D.slideBack = 0.25 * sm(0, 0.3); D.kneel = sm(0.3, 0.9); D.lean = 0.3 * D.kneel + 0.2 * sm(1.5, 1.9);
        D.rotZ = (fin.side || 1) * fall(1.5, 2.05, 1.38);
        D.dy = -0.04 * sm(1.9, 2.1);
        if (k < 1.9) { const w = [0.08, -0.22, -0.28]; arms(w, [w[0], w[1] + 0.02, w[2]]); }
        else arms([0.4, -0.05, -0.1], [-0.3, -0.1, -0.3]);
        break;
      }
      case 'spin':      // разворачивает ударом и опрокидывает навзничь
        D.yaw = Math.PI * (fin.side || 1) * sm(0, 0.6); backFall(0.3); break;
      case 'slam':      // сокрушающий удар: отлетает назад
        D.slideBack = 0.7 * sm(0, 0.5); backFall(0); D.dy += 0.25 * Math.sin(Math.PI * clamp(k / 0.5, 0, 1)); break;
      default:          // обычное падение (пропасть, разбился)
        backFall(0);
    }
    return D;
  }

  // Победитель в сценке: поза клинка и движения корпуса
  killerPose(f, time, pose) {
    const fin = f.fin;
    if (!fin || fin.role !== 'killer' || f.dead) return { pose, yaw: 0, crouch: 0, fwd: 0 };
    const k = time - fin.t0;
    if (k < 0 || k > 2.8) return { pose, yaw: 0, crouch: 0, fwd: 0 };
    const sm = (a, b) => smooth01((k - a) / (b - a));
    let T = null, w = 0, yaw = 0, crouch = 0, fwd = 0;
    // В конце любой сценки — опускает клинок и выпрямляется
    const rest = { h: [0.32, -0.44, -0.2], d: norm3([0.25, -0.9, 0.15]) };
    switch (fin.type) {
      case 'impale': T = { h: [0.05, -0.26, -0.52], d: [0, 0.03, -1] }; w = 1 - sm(0.95, 1.3); fwd = 0.18 * w; break;   // клинок насквозь, затем выдёргивает
      case 'hand': T = { h: [0.3, -0.42, -0.3], d: norm3([0.4, -0.6, -0.7]) }; w = 1 - sm(1.0, 1.4); break;            // замер после рассекающего удара
      case 'spin': yaw = -TAU * easeInOut(clamp(k / 0.55, 0, 1)) * (fin.side || 1); T = { h: [-0.2, -0.3, -0.35], d: norm3([-0.8, -0.3, -0.5]) }; w = 1 - sm(0.8, 1.2); break;
      case 'slam': T = { h: [0.1, -0.45, -0.5], d: norm3([0.1, -0.7, -0.7]) }; w = 1 - sm(0.7, 1.1); crouch = 0.35 * (1 - sm(0.3, 0.9)); break;
      default: break;
    }
    if (!pose) return { pose: null, yaw, crouch, fwd };
    let p = T ? smoothPose(pose, T, w) : pose;
    p = smoothPose(p, rest, sm(1.5, 2.1));
    return { pose: p, yaw, crouch, fwd };
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
        case 'reverseFlip': {
          // Перехват в кисти: из обратного хвата в прямой и обратно — клинок проворачивается вокруг кулака у бедра
          const a = TAU * 2 * e;
          T = { h: [0.4 * sgn, -0.28, -0.3], d: rot3([0.3 * sgn, -0.75, 0.55], [0, 0, -1], sgn * a) };
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
    const DA = f.dead ? this.deathAnim(f, time) : null;
    this.killerFx = f.fin && f.fin.role === 'killer' && !f.dead ? this.killerPose(f, time, null) : null;
    // Ход удара 0..1 (замах + удар) и сила выпада/шага: растёт к удару, гаснет в откате
    const ap = atk && f.attack ? clamp((st === 'windup' ? f.stateT : f.attack.windup + f.stateT) / (f.attack.windup + CFG.STRIKE), 0, 1) : 0;
    let lungeK = 0;
    if (atk) lungeK = clamp((ap - 0.45) / 0.4, 0, 1);
    else if (st === 'recover' && f.attack) lungeK = 1 - easeInOut(clamp(f.stateT / (f.dur * 0.75), 0, 1));
    this.lungeK = expTo(this.lungeK || 0, lungeK, 20, dt);
    const LK = this.lungeK;
    const stompK = st === 'strike' && SP.stomp ? Math.sin(Math.PI * clamp(f.stateT / CFG.STRIKE, 0, 1)) * SP.stomp : 0;
    const crouchT = 0.05 + (SP.crouch || 0) + 0.15 * LK * (SP.lunge || 0) + 0.35 * stompK + (this.killerFx ? this.killerFx.crouch : 0) + this.land * 0.8 + (f.prepT > 0 ? 0.55 : 0) + (st === 'dodge' ? 0.35 : 0) + (f.blocking ? 0.08 : 0) + (st === 'bind' ? 0.15 : 0) + (atk ? 0.1 : 0);
    this.crouch = expTo(this.crouch, f.dead ? 0 : crouchT, 22, dt);
    this.kneel = DA ? DA.kneel : 0;

    // Моргание: каждые несколько секунд глаза закрываются на долю секунды; у погибшего — закрыты
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkK = 0.14; this.blinkT = rand(2.2, 5.5); }
    this.blinkK = Math.max(0, this.blinkK - dt);
    const lid = f.dead ? 0.08 : this.blinkK > 0 ? 0.08 + 0.92 * Math.abs(this.blinkK - 0.07) / 0.07 : 1;
    for (const e of this.eyes) e.scale.y = lid;
    if (this.lids) for (let i = 0; i < this.lids.length; i += 2) this.lids[i].rotation.x = -0.12 - (1 - lid) * 0.9;   // моргая, веко опускается

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
        } else if (f.weapon === 'reverse' && AT.heavy) {
          // Обратный хват, тяжёлый: прыжок с винтом
          this.root.rotation.y = f.yaw + TAU * easeInOut(clamp((ap - 0.1) / 0.85, 0, 1)) * (isLeftSide(AT.dir) ? 1 : -1);
          this.root.position.y += 0.4 * Math.sin(Math.PI * clamp((ap - 0.1) / 0.9, 0, 1)) * this.scale;
        } else if ((ACR.spinCombo || f.weapon === 'reverse') && sideOk && (AT.combo >= 1 || (ACR.spinHeavy && AT.heavy))) {
          this.root.rotation.y = f.yaw + TAU * easeInOut(clamp((ap - 0.15) / 0.8, 0, 1)) * (isLeftSide(AT.dir) ? 1 : -1);
        }
      }
      if (ACR.leapHeavy && AT.heavy) this.root.position.y += ACR.leapHeavy * Math.sin(Math.PI * clamp((ap - 0.15) / 0.85, 0, 1)) * this.scale;
    }
    // Уклонение у каждой формы своё. Работает и от первого лица: камера крутится вместе с телом (как при сальто)
    let acroRoll = 0, dFx = 0, dFz = 0, dYaw = 0;
    if (st === 'dodge') {
      const k = clamp(f.stateT / f.dur, 0, 1), e = easeInOut(k), bell = Math.sin(Math.PI * k);
      const fw0 = fwdOf(f.yaw), rt0 = rightOf(f.yaw);
      const lx = f.vx * rt0.x + f.vz * rt0.z, lz = f.vx * fw0.x + f.vz * fw0.z, side = Math.abs(lx) > Math.abs(lz);
      const hop = h => { this.root.position.y += h * bell * this.scale; };
      // Переворот занимает середину ухода: разбег, оборот, приземление
      const turn = easeInOut(clamp((k - 0.08) / 0.8, 0, 1));
      switch (f.style) {
        case 'ataru':   // колесо вбок или сальто назад
          if (side) { dFz = -sign(lx) * TAU * turn; hop(0.55); } else { dFx = (lz < 0 ? 1 : -1) * TAU * turn; hop(0.75); }
          break;
        case 'niman':   // сальто с помощью Силы
          if (side) { dFz = -sign(lx) * TAU * turn; hop(0.6); } else { dFx = (lz < 0 ? 1 : -1) * TAU * turn; hop(0.7); }
          break;
        case 'juyo':    // пируэт
          dYaw = TAU * e * (lx >= 0 ? -1 : 1); hop(0.15);
          break;
        case 'shii':    // кувырок по ходу ухода, у самой земли
          if (side) dFz = -sign(lx) * TAU * turn; else dFx = (lz < 0 ? 1 : -1) * TAU * turn;
          this.root.position.y -= 0.4 * Math.sin(Math.PI * clamp((k - 0.05) / 0.85, 0, 1)) * this.scale;
          break;
        case 'makashi': hop(0.14); break;                                   // фехтовальный подскок
        case 'soresu': dYaw = 0.9 * bell * (lx >= 0 ? -1 : 1); break;       // уход поворотом корпуса
        case 'djemso': this.root.position.y -= 0.08 * bell * this.scale; break;   // тяжёлый шаг с приседом
      }
      acroFlip += dFx; acroRoll += dFz; this.root.rotation.y += dYaw;
    }
    this.visFx = dFx; this.visFz = dFz; this.visYaw = dYaw;   // для камеры от первого лица
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
    this.root.rotation.x = 0; this.root.rotation.z = 0;
    if (DA) {
      // Сценка поражения: сдвиг к клинку победителя (пронзание) или назад, разворот, падение
      const fin = f.fin;
      if (fin && DA.slide && fin.role === 'victim') {
        const kf = fwdOf(fin.kyaw), tx = fin.kx + kf.x * 1.0, tz = fin.kz + kf.z * 1.0, w = smooth01((time - fin.t0) / 0.25);
        this.root.position.x = lerp(f.x, tx, w); this.root.position.z = lerp(f.z, tz, w);
      }
      if (DA.slideBack) { const fw0 = fwdOf(f.yaw); this.root.position.x -= fw0.x * DA.slideBack; this.root.position.z -= fw0.z * DA.slideBack; }
      this.root.position.y += DA.dy * this.scale;
      this.root.rotation.y += DA.yaw;
      this.root.rotation.x = DA.rotX; this.root.rotation.z = DA.rotZ;
    }
    if (this.killerFx && this.killerFx.yaw && !ctx.fp) this.root.rotation.y += this.killerFx.yaw;
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
    const fwdShift = lungeMul * 0.26 * LK + (SP.stepIn || 0) * LK + (this.killerFx ? this.killerFx.fwd : 0);
    // Перенос веса: в стойке медленно с ноги на ногу; в замахе вес назад, в ударе — на переднюю ногу; в блоке — чуть назад
    let wsX = 0, wsZ = 0;
    if (st === 'idle' && !f.blocking && f.onGround && !f.dead && mv < 0.2) wsX = Math.sin(time * 0.33 + f.index * 1.7) * 0.022;
    if (atk && f.attack) { wsZ = st === 'windup' ? 0.03 * clamp(f.stateT / f.dur, 0, 1) : -0.05; if (st === 'strike') wsX += 0.02; }
    if (f.blocking) wsZ += 0.02;
    this.wsX = expTo(this.wsX || 0, f.dead ? 0 : wsX, 6, dt); this.wsZ = expTo(this.wsZ || 0, f.dead ? 0 : wsZ, 10, dt);
    B.hips.position.set(this.rest.hips.x + this.wsX, this.rest.hips.y - this.crouch * 0.3 - bob - this.kneel * 0.42, this.rest.hips.z + this.crouch * 0.04 - fwdShift + parryStep + this.kneel * 0.05 + this.wsZ);
    // Ходьба: таз проседает на каждом шаге; корпус наклоняется по ходу движения и кренится при боковом шаге
    const fwM = fwdOf(f.yaw), rtM = rightOf(f.yaw);
    const vfM = (f.vx * fwM.x + f.vz * fwM.z) / 4.5, vsM = (f.vx * rtM.x + f.vz * rtM.z) / 4.5;
    const moving = f.onGround && !f.dead && (st === 'idle' || st === 'recover');
    this.moveLean = expTo(this.moveLean || 0, moving ? clamp(vfM, -1, 1) * 0.14 : 0, 8, dt);
    this.moveRoll = expTo(this.moveRoll || 0, moving ? clamp(vsM, -1, 1) * 0.09 : 0, 8, dt);
    B.hips.rotation.set(-this.crouch * 0.2 - this.tuck * 0.35, Math.sin(f.walkPhase) * 0.08 * mv, Math.sin(f.walkPhase * 2) * 0.03 * mv - this.wsX * 1.2);   // таз проседает на ненагруженной стороне

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
    if (f.dead) { lean = DA ? DA.lean : 0; twist = 0; }
    else if (st === 'idle' && f.onGround) {
      // Живая стойка: лёгкое покачивание корпусом
      twist += Math.sin(time * 0.8 + f.index) * 0.035;
    }
    // Вес и инерция: корпус догоняет цель пружиной — с лёгким перехлёстом и затуханием, а не равномерно
    const spring = (key, target, freq, zeta) => {
      const w = TAU * freq, v = this[key + 'V'] || 0;
      const a = w * w * (target - this[key]) - 2 * zeta * w * v;
      this[key + 'V'] = clamp(v + a * Math.min(dt, 1 / 30), -12, 12);
      this[key] += this[key + 'V'] * Math.min(dt, 1 / 30);
    };
    // Пропущенный удар — физический толчок корпусу
    if (f.hitFxT !== this.lastHitT) { if (this.lastHitT != null && time - f.hitFxT < 0.1) { this.leanV = (this.leanV || 0) + 2.2; this.twistV = (this.twistV || 0) + 3.5 * (f.hitFxSide || (Math.random() < 0.5 ? 1 : -1)); } this.lastHitT = f.hitFxT; }
    if (f.dead || f.flip || st === 'dodge' || st === 'roll' || hanging) { this.lean = expTo(this.lean, lean, 14, dt); this.twist = expTo(this.twist, twist, 14, dt); this.leanV = this.twistV = 0; }
    else { spring('lean', lean, 3.0, 0.55); spring('twist', twist, 2.8, 0.5); }
    // Голова чуть запаздывает за корпусом и догоняет его
    this.headTw = this.headTw == null ? this.twist : this.headTw; spring('headTw', this.twist, 2.2, 0.7);
    // Плечи идут против таза — шаг выглядит живым; голова держит горизонт
    // Дыхание зависит от выносливости: отдохнувший дышит редко и спокойно, уставший — часто и тяжело, плечи поднимаются
    const fresh = clamp(f.stam / CFG.STAM_MAX, 0, 1);
    this.brPh = (this.brPh || 0) + dt * TAU * lerp(0.95, 0.27, fresh);
    const br = f.dead ? 0 : Math.sin(this.brPh) * lerp(1, 0.35, fresh);
    B.chest.position.y = this.rest.chest.y + br * 0.006;
    B.clavR.position.y = this.rest.clavR.y + Math.max(0, br) * 0.008 * (1.2 - fresh);
    B.clavL.position.y = this.rest.clavL.y + Math.max(0, br) * 0.008 * (1.2 - fresh);
    const counter = -Math.sin(f.walkPhase) * 0.1 * mv;
    const L2 = this.lean + this.moveLean - br * 0.02, R2 = -this.moveRoll;
    B.spine.rotation.set(L2 * 0.45, this.twist * 0.4 + counter * 0.5, R2 * 0.5);
    B.chest.rotation.set(L2 * 0.55, this.twist * 0.6 + counter, R2 * 0.5);
    const look = clamp(ctx.pitch || 0, -0.7, 0.6);
    const lag = (this.headTw - this.twist) * 0.6;
    B.neck.rotation.set(0.4 * (look - L2), -this.twist * 0.4 - counter * 0.8 + lag * 0.5, -R2 * 0.4);
    B.head.rotation.set(0.6 * (look - L2), -this.twist * 0.6 - counter * 0.7 + lag * 0.5, -R2 * 0.6);
    this.root.updateMatrixWorld(true);
    // Взгляд: глаза следят за головой противника и делают мелкие быстрые скачки, как у живого человека
    if (!(this.saccT > 0)) { this.saccT = rand(0.4, 1.9); this.sacc = [rand(-0.06, 0.06), rand(-0.04, 0.04)]; }
    this.saccT -= dt;
    let eyY = this.sacc[0], eyP = this.sacc[1];
    if (this.lookTarget && !f.dead) {
      const loc = B.head.worldToLocal(this.lookTarget.clone());
      loc.y -= J.eyeLocal[1]; loc.z += 0.07;
      const L = loc.length() || 1;
      eyY += Math.atan2(-loc.x, -loc.z); eyP += Math.asin(clamp(loc.y / L, -1, 1));
    }
    this.eyY = expTo(this.eyY || 0, clamp(eyY, -0.45, 0.45), 35, dt);
    this.eyP = expTo(this.eyP || 0, clamp(eyP, -0.3, 0.3), 35, dt);
    for (const e of this.eyes) e.rotation.set(this.eyP, this.eyY, 0);
    if (this.lids) for (let i = 0; i < this.lids.length; i += 2) this.lids[i].position.y = J.eyeLocal[1] + this.eyP * 0.004;   // веко немного следует за взглядом
    this.headWorld = (this.headWorld || new THREE.Vector3()); B.head.getWorldPosition(this.headWorld); this.headWorld.y += 0.08 * this.scale;

    // Ноги
    this.modelG.getWorldQuaternion(_qm);
    const fw = fwdOf(f.yaw), rt = rightOf(f.yaw);
    const vf = f.vx * fw.x + f.vz * fw.z, vs = f.vx * rt.x + f.vz * rt.z, sp = Math.hypot(vf, vs) || 1;
    // Стопы «прилипают» к полу, пока боец стоит или идёт медленно; на бегу и в акробатике — обычный цикл шага
    const plantOK = !Character.noPlant && f.onGround && !f.dead && f.speed < 1.2 && this.kneel === 0 && !this.flourish &&
      !['dodge', 'roll', 'kick', 'vault', 'climb', 'hang'].includes(st);
    if (!this.plant) this.plant = {};
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
      if (this.kneel > 0) foot = lerp3(foot, [sg * 0.12, 0.07, 0.34], this.kneel);   // на коленях: стопы за спиной
      if (DA && DA.spread) foot = [foot[0] + sg * DA.spread * (sg > 0 ? 1.5 : 0.7), foot[1], foot[2]];   // лёжа ноги чуть разведены
      if (st === 'kick' && sg > 0) {
        // Пинок правой: колено вверх, затем выброс стопы вперёд на уровне пояса
        const t = clamp(f.stateT / f.dur, 0, 1);
        const up = Math.sin(Math.PI * Math.min(1, t / 0.75));
        const out = t < 0.36 ? t / 0.36 : Math.max(0, 1 - (t - 0.36) / 0.4);
        foot = lerp3(ground, lerp3([0.1, 0.55, -0.25], [0.08, 0.92, -0.6], out), up);
      }
      _t.set(foot[0], foot[1], foot[2]);
      let target = this.modelG.localToWorld(_t.clone());
      if (plantOK && !(st === 'kick' && sg > 0)) {
        // Стопа держит место в мире; когда тело ушло далеко — быстрый шаг на новое место
        let pl = this.plant[S];
        if (!pl) pl = this.plant[S] = { w: target.clone(), t: -1, from: new THREE.Vector3() };
        if (pl.t >= 0) {
          pl.t += dt / 0.16;
          const k = smooth01(pl.t);
          pl.w.lerpVectors(pl.from, target, k);
          pl.w.y += Math.sin(Math.PI * clamp(pl.t, 0, 1)) * 0.07 * this.scale;
          if (pl.t >= 1) { pl.t = -1; pl.w.copy(target); }
        } else {
          const other = this.plant[S === 'R' ? 'L' : 'R'];
          if (Math.hypot(pl.w.x - target.x, pl.w.z - target.z) > 0.14 * this.scale && !(other && other.t >= 0)) { pl.from.copy(pl.w); pl.t = 0; }
          pl.w.y = target.y;
        }
        target = pl.w.clone();
      } else delete this.plant[S];
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
    if (this.killerFx) pose = this.killerPose(f, time, pose).pose;
    if (W === 'reverse') pose = this.reversePose(f, pose, ap);
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
      const rest = B.chest.localToWorld(new THREE.Vector3(-0.28, -0.3, -0.24));   // спокойная рука чуть впереди, ладонь вперёд
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
      // Руки не торчат: висят, взлетают при падении, выставляются вперёд, хватаются за запястье
      const ar = DA && DA.armR ? DA.armR : [0.22, -0.46, 0.02], al = DA && DA.armL ? DA.armL : [-0.22, -0.46, 0.02];
      rightT = B.chest.localToWorld(new THREE.Vector3(ar[0], ar[1], ar[2]));
      leftT = B.chest.localToWorld(new THREE.Vector3(al[0], al[1], al[2]));
    }
    B.handR.scale.setScalar(DA && DA.handGone ? 0.001 : 1);   // отсечённая кисть
    for (const S of ['R', 'L']) {
      const sg = S === 'R' ? 1 : -1;
      const pole = new THREE.Vector3(sg * 0.6, -1, 0.35).applyQuaternion(_qm);
      if (hanging) pole.set(sg * 0.8, -0.3, 0.5).applyQuaternion(_qm);
      this.twoBone(B['upperArm' + S], B['foreArm' + S], B['hand' + S], S === 'R' ? rightT : leftT, pole);
    }

    // Клинок в правой кисти, а если выбит — лежит на земле (или летит)
    if (DA && DA.handGone) {
      // Рукоять вместе с кистью падает на землю
      const grip = B.handR.getWorldPosition(new THREE.Vector3());
      if (!this.hilt) this.hilt = { p: grip.clone(), v: new THREE.Vector3(rightOf(f.yaw).x * 0.9, 1.4, rightOf(f.yaw).z * 0.9), spin: 0, rest: false };
      const H = this.hilt;
      if (!H.rest) {
        H.v.y -= 9.8 * dt; H.p.addScaledVector(H.v, dt); H.spin += dt * 11;
        const gy = ARENA.groundAt(H.p.x, H.p.z, H.p.y + 0.1).y + 0.03;
        if (H.p.y <= gy) { H.p.y = gy; H.rest = true; }
      }
      this.blade.group.position.copy(H.p);
      this.blade.group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.cos(H.spin), H.rest ? 0.05 : Math.sin(H.spin), 0.3).normalize());
      this.blade.group.visible = this.visible;
    } else if (f.disarm) {
      const D = f.disarm;
      this.blade.group.position.set(D.x, D.y, D.z);
      const spin = D.landed ? 0 : D.t * 14;
      this.blade.group.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.cos(spin + D.vx), D.landed ? 0.04 : Math.sin(spin), Math.sin(spin + D.vz)).normalize());
      this.blade.group.visible = !D.lost && this.visible;
    } else {
      const grip = B.handR.localToWorld(new THREE.Vector3(J.armDirR[0] * 0.05, J.armDirR[1] * 0.05, J.armDirR[2] * 0.05));
      this.root.updateMatrixWorld(true);
      const caps = this.bodyCaps('R');
      let dn = bladeDir.normalize();
      if (W === 'staff') {
        // Посох: общая рукоять между кистями, лезвия в обе стороны — отводим ось так, чтобы оба лезвия не задевали тело
        const c = grip.clone().addScaledVector(dn, -0.12 * s * (1 - (this.flW || 0)));   // при вращении хват плавно уходит на середину
        const capsS = this.bodyCaps(this.flW > 0.5 ? 'R' : 'RL');
        for (let it = 0; it < 2; it++) {
          const up = clearBladeDir(c, dn, capsS, 0.25 * s, 1.18 * s), down = clearBladeDir(c, dn.clone().negate(), capsS, 0.25 * s, 1.18 * s);
          dn = up.sub(down).normalize();
        }
        this.staffC = c; this.staffDir = dn.clone();
        this.blade.group.position.copy(c).addScaledVector(dn, 0.03);
        this.blade.group.quaternion.setFromUnitVectors(UP, dn);
      } else {
        // Обратный хват: d позы уже указывает направление лезвия
        dn = this.interceptDir(f, grip, dn, time);
        dn = clearBladeDir(grip, dn, caps, 0.2 * s, 1.15 * s);
        if (W === 'reverse') {
          // Лезвие догоняет нужное направление плавно (взмахом со следом), а не перескакивает
          if (!this.revSm) this.revSm = dn.clone();
          else {
            const q = new THREE.Quaternion().setFromUnitVectors(this.revSm, dn);
            this.revSm.applyQuaternion(new THREE.Quaternion().slerp(q, 1 - Math.exp(-(atk ? 28 : 11) * dt))).normalize();
          }
          dn = clearBladeDir(grip, this.revSm.clone(), caps, 0.2 * s, 1.15 * s);
          this.revSm.copy(dn);
        } else this.revSm = null;
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
          this.blade2.group.position.copy(this.staffC).addScaledVector(this.staffDir, -0.03);
          this.blade2.group.quaternion.setFromUnitVectors(UP, this.staffDir.clone().negate());
        } else {
          const gripL = B.handL.localToWorld(new THREE.Vector3(J.armDirL[0] * 0.05, J.armDirL[1] * 0.05, J.armDirL[2] * 0.05));
          const dl = clearBladeDir(gripL, bladeDirL.clone().normalize(), this.bodyCaps('L'), 0.2 * s, 1.15 * s);
          this.blade2.group.position.copy(gripL);
          this.blade2.group.quaternion.setFromUnitVectors(UP, dl);
        }
        this.blade2.setIgnite(f.ignite);
        this.blade2.group.updateMatrixWorld(true);
        this.blade2Seg = f.ignite > 0.5 ? bladeSegOf(this.blade2, f.ignite) : null;
        if (this.visible) this.blade2.sampleTrail(this.poseAnim.speed * 1.1, dt);
      } else { this.blade2.trail.reset(); this.blade2Seg = null; }
    }
    if (!(DA && DA.handGone)) this.hilt = null;
    // Прижжённое запястье тлеет огоньком
    if (DA && DA.handGone) {
      if (!this.ember) {
        this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.scene.add(this.ember);
      }
      const kk = time - f.fin.t0;
      this.ember.visible = this.visible;
      B.foreArmR.localToWorld(this.ember.position.set(J.armDirR[0] * 0.24, J.armDirR[1] * 0.24, J.armDirR[2] * 0.24));
      this.ember.material.opacity = clamp(1 - (kk - 1.2) / 1.6, 0, 1) * (0.75 + 0.25 * Math.sin(time * 37));
    } else if (this.ember) this.ember.visible = false;
    this.blade.setIgnite(f.ignite);
    // Отрезки своих клинков (для встречи клинков и искр в точке контакта)
    this.bladeSegs = [];
    if (f.ignite > 0.5 && !f.disarm && !(DA && DA.handGone)) this.bladeSegs.push(bladeSegOf(this.blade, f.ignite));
    if (this.blade2Seg) this.bladeSegs.push(this.blade2Seg);
    this.blade.group.updateMatrixWorld(true);
    if (this.visible) this.blade.sampleTrail(this.poseAnim.speed, dt);

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
