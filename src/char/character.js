'use strict';
// Персонаж: скелет + сетки из CharGen + ткань + процедурная анимация (IK рук и ног).
const CharCache = new Map();
function charKey(look) { const L = Object.assign({}, look); delete L.colors; delete L.name; delete L.style; return JSON.stringify(L) + '|' + CharGen.detail; }
function getCharData(look) {
  const k = charKey(look);
  if (!CharCache.has(k)) CharCache.set(k, CharGen.build(look));
  return CharCache.get(k);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Vector3(), _n = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qm = new THREE.Quaternion();
const expTo = (v, t, rate, dt) => v + (t - v) * (1 - Math.exp(-rate * dt));

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
    scene.add(this.blade.group);
    this.poseAnim = new PoseAnim();

    this.cloth = [];
    this.buildCloth(look);

    Object.assign(this, { airK: 0, land: 0, wasAir: false, lastVy: 0, tuck: 0, crouch: 0.05, lean: 0, twist: 0, visible: true });
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
    for (const c of this.cloth) c.mesh.visible = v;
    if (this.rope) this.rope.mesh.visible = v;
    if (!v) this.blade.trail.reset();
  }

  setBladeColor(c) { this.blade.setColor(c); }

  // Голову, волосы, глаза и капюшон своего бойца камера от первого лица не видит
  setFpOwner(v) { this.fpOwner = v; for (const m of this.fpMeshes) m.layers.set(v ? 1 : 0); }

  dispose() {
    this.scene.remove(this.root); this.scene.remove(this.blade.group); this.blade.dispose(this.scene);
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
    // Атару: подскок в каждом ударе, а связки и тяжёлые — с разворотом вокруг себя
    if (SP.hop && atk) this.root.position.y += Math.sin(Math.PI * clamp((ap - 0.35) / 0.65, 0, 1)) * 0.14 * SP.hop * this.scale;
    if (SP.spin && atk && f.attack && (f.attack.combo >= 1 || f.attack.heavy) && !ctx.fp && f.attack.dir !== DIR.THRUST) {
      this.root.rotation.y = f.yaw + TAU * easeInOut(clamp((ap - 0.15) / 0.8, 0, 1)) * (isLeftSide(f.attack.dir) ? 1 : -1);
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
    this.flipG.rotation.set(fx, 0, fz);

    // Таз и корпус
    const mv = clamp(f.speed / 3.2, 0, 1) * (f.onGround || f.wallRun ? 1 : 0);
    let bob = f.onGround && !f.dead ? Math.abs(Math.cos(f.walkPhase)) * 0.025 * mv : 0;
    if (SP.bounce && f.onGround && !f.dead && st === 'idle') bob += (Math.sin(time * 6.5) * 0.5 + 0.5) * 0.035 * (1 - mv);   // Атару пружинит
    const fwdShift = (SP.lunge || 0) * 0.26 * LK + (SP.stepIn || 0) * LK;
    B.hips.position.set(this.rest.hips.x, this.rest.hips.y - this.crouch * 0.3 - bob, this.rest.hips.z + this.crouch * 0.04 - fwdShift);
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
      const step = (SP.lunge || 0) * 0.42 + (SP.stepIn || 0) * 1.8;
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
    const pose = this.poseAnim.update(f, time, dt);
    const E0 = _e.set(J.eye[0] - J.chest[0], J.eye[1] - J.chest[1], J.eye[2] - J.chest[2]);
    const handR = B.chest.localToWorld(new THREE.Vector3(E0.x + pose.h[0] * 0.95, E0.y + pose.h[1], E0.z + pose.h[2] * 0.8));
    B.chest.getWorldQuaternion(_q1);
    const bladeDir = new THREE.Vector3(pose.d[0], pose.d[1], pose.d[2]).applyQuaternion(_q1);
    let handL = handR.clone().addScaledVector(bladeDir, -0.1 * s);
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
    } else if (!atk && !f.dead && st !== 'bind') {
      // В воздухе левая рука отпускает рукоять для равновесия, в группировке — хватает колено
      const bal = B.chest.localToWorld(new THREE.Vector3(-0.42, -0.02, -0.12));
      leftT = handL.clone().lerp(bal, this.airK * (1 - this.tuck));
      const knee = B.shinL.getWorldPosition(new THREE.Vector3()).addScaledVector(bladeDir, 0).add(new THREE.Vector3(0, 0.02 * s, 0));
      leftT.lerp(knee, this.tuck);
    }
    // Ниман: свободная рука — для Силы: раскрытая ладонь вперёд, в ударе выбрасывается к сопернику
    if (SP.forceHand && !hanging && st !== 'vault' && st !== 'bind' && st !== 'push' && st !== 'pull' && !f.dead) {
      const rest = B.chest.localToWorld(new THREE.Vector3(-0.34, -0.06, -0.3));
      const cast = B.chest.localToWorld(new THREE.Vector3(-0.16, 0.08, -0.58));
      const hand = rest.lerp(cast, atk ? Math.sin(Math.PI * ap) : 0);
      leftT = leftT.clone().lerp(hand, 1 - this.airK * (1 - this.tuck));
    }
    // Макаши: клинок в одной руке, свободная рука за спиной
    if (SP.oneHand && !hanging && st !== 'vault' && st !== 'bind' && st !== 'push' && st !== 'pull' && !f.dead) {
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
      this.blade.group.position.copy(grip);
      this.blade.group.quaternion.setFromUnitVectors(UP, bladeDir.normalize());
      this.blade.group.visible = this.visible;
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
