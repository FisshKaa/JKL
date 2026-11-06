'use strict';
// Ткань на частицах (Verlet): верхний ряд пришит к костям, остальное висит, сталкивается
// с капсулами ног и корпуса и реагирует на движение, сальто и падения.
const _cv = new THREE.Vector3(), _cw = new THREE.Vector3();
const CLOTH = { iters: 4, maxSub: 4 };   // точность ткани (снижается на слабом качестве)

class ClothPanel {
  // rest(i, j) → точка в модельном пространстве A-позы; pin(i, j) → имя кости или null
  constructor(char, opt) {
    this.char = char;
    const { cols, rows, rest, pin, material, closed = false, stiff = 1, shell = null, collide = null } = opt;
    this.collide = collide;
    this.shell = shell;
    this._inv = new THREE.Matrix4();
    this.cols = cols; this.rows = rows; this.closed = closed;
    const n = cols * rows;
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.restModel = new Float32Array(n * 3);
    this.pinBone = new Array(n).fill(null);
    this.pinLocal = [];
    const J = char.J;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, p = rest(i, j), b = pin(i, j);
      this.restModel[k * 3] = p[0]; this.restModel[k * 3 + 1] = p[1]; this.restModel[k * 3 + 2] = p[2];
      if (b) {
        this.pinBone[k] = char.bones[b];
        const bp = J.bone[b];
        this.pinLocal[k] = new THREE.Vector3(p[0] - bp[0], p[1] - bp[1], p[2] - bp[2]);
      }
    }
    // Связи: соседние (растяжение), диагонали (сдвиг), через одну (изгиб)
    const cons = [];
    const link = (a, b, w) => {
      const ax = this.restModel[a * 3] - this.restModel[b * 3], ay = this.restModel[a * 3 + 1] - this.restModel[b * 3 + 1], az = this.restModel[a * 3 + 2] - this.restModel[b * 3 + 2];
      cons.push(a, b, Math.sqrt(ax * ax + ay * ay + az * az) * char.scale, w);
    };
    const id = (i, j) => j * cols + ((i + cols) % cols);
    const wrap = closed ? cols : cols - 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (i < wrap) link(id(i, j), id(i + 1, j), 1);
      if (j < rows - 1) link(id(i, j), id(i, j + 1), 1);
      if (j < rows - 1 && i < wrap) { link(id(i, j), id(i + 1, j + 1), 0.7); link(id(i + 1, j), id(i, j + 1), 0.7); }
      if (j < rows - 2) link(id(i, j), id(i, j + 2), 0.35 * stiff);
      if (i < wrap - 1) link(id(i, j), id(i + 2, j), 0.3 * stiff);
    }
    this.cons = new Float32Array(cons);

    // Сетка для отрисовки
    const idx = [];
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < wrap; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    // Фактура ткани в цветах вершин, по положению в покое
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const x = this.restModel[k * 3], y = this.restModel[k * 3 + 1], z = this.restModel[k * 3 + 2];
      let v = 0.9 + 0.07 * SDF.noise(x * 22, y * 22, z * 22) + 0.03 * SDF.noise(x * 70, y * 70, z * 70);
      // Потёртый, потемневший край подола
      const t = Math.floor(k / cols) / Math.max(1, rows - 1);
      if (t > 0.84) v *= 1 - 0.22 * ((t - 0.84) / 0.16) * (0.8 + 0.2 * SDF.noise(x * 60, 1, z * 60));
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    char.scene.add(this.mesh);
    this.needReset = true;
  }

  pinWorld(k, out) { return out.copy(this.pinLocal[k]).applyMatrix4(this.pinBone[k].matrixWorld); }

  reset() {
    const M = this.char.modelG.matrixWorld;
    for (let k = 0; k < this.n; k++) {
      _cv.set(this.restModel[k * 3], this.restModel[k * 3 + 1], this.restModel[k * 3 + 2]);
      if (this.pinBone[k]) this.pinWorld(k, _cv); else _cv.applyMatrix4(M);
      this.pos[k * 3] = this.prev[k * 3] = _cv.x; this.pos[k * 3 + 1] = this.prev[k * 3 + 1] = _cv.y; this.pos[k * 3 + 2] = this.prev[k * 3 + 2] = _cv.z;
    }
    this.needReset = false;
  }

  step(dt, colliders, floorY) {
    if (this.needReset) this.reset();
    const P = this.pos, Q = this.prev;
    // Телепорт (новый раунд) — сброс
    for (let k = 0; k < this.n; k++) if (this.pinBone[k]) {
      this.pinWorld(k, _cv);
      if (Math.abs(_cv.x - P[k * 3]) + Math.abs(_cv.z - P[k * 3 + 2]) > 1.5) { this.reset(); break; }
      break;
    }
    const sub = Math.max(1, Math.min(CLOTH.maxSub, Math.ceil(dt / (1 / 120))));
    const h = dt / sub, g = -9.8 * h * h, damp = 0.992;
    if (this.collide) colliders = colliders.filter(c => this.collide.includes(c.tag));
    for (let s = 0; s < sub; s++) {
      for (let k = 0; k < this.n; k++) {
        const o = k * 3;
        if (this.pinBone[k]) {
          this.pinWorld(k, _cv);
          Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
          P[o] = _cv.x; P[o + 1] = _cv.y; P[o + 2] = _cv.z;
          continue;
        }
        const vx = (P[o] - Q[o]) * damp, vy = (P[o + 1] - Q[o + 1]) * damp, vz = (P[o + 2] - Q[o + 2]) * damp;
        Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
        P[o] += vx; P[o + 1] += vy + g; P[o + 2] += vz;
      }
      const C = this.cons;
      const shellBone = this.shell ? this.char.bones[this.shell.bone] : null;
      if (shellBone) this._inv.copy(shellBone.matrixWorld).invert();
      for (let it = 0; it < CLOTH.iters; it++) {
        for (let c = 0; c < C.length; c += 4) {
          const a = C[c] * 3, b = C[c + 1] * 3, L = C[c + 2], w = C[c + 3];
          const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const pa = this.pinBone[C[c]] ? 0 : 1, pb = this.pinBone[C[c + 1]] ? 0 : 1;
          if (pa + pb === 0) continue;
          const diff = (d - L) / d * w / (pa + pb);
          P[a] += dx * diff * pa; P[a + 1] += dy * diff * pa; P[a + 2] += dz * diff * pa;
          P[b] -= dx * diff * pb; P[b + 1] -= dy * diff * pb; P[b + 2] -= dz * diff * pb;
        }
        // Столкновения с телом
        for (let k = 0; k < this.n; k++) {
          if (this.pinBone[k]) continue;
          const o = k * 3;
          for (const cl of colliders) {
            const ax = cl.a.x, ay = cl.a.y, az = cl.a.z, bx = cl.b.x - ax, by = cl.b.y - ay, bz = cl.b.z - az;
            const px = P[o] - ax, py = P[o + 1] - ay, pz = P[o + 2] - az;
            let t = (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz + 1e-9);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = px - bx * t, qy = py - by * t, qz = pz - bz * t;
            const d2 = qx * qx + qy * qy + qz * qz;
            if (d2 < cl.r * cl.r) {
              const d = Math.sqrt(d2) || 1e-6, push = (cl.r - d) / d;
              P[o] += qx * push; P[o + 1] += qy * push; P[o + 2] += qz * push;
            }
          }
          // Оболочка слоя в системе кости (таз): держит ткань снаружи или внутри других слоёв
          if (shellBone) {
            _cv.set(P[o], P[o + 1], P[o + 2]).applyMatrix4(this._inv);
            const bx = _cv.x, by = _cv.y, bz = _cv.z;
            this.shell.fn(_cv);
            if (_cv.x !== bx || _cv.y !== by || _cv.z !== bz) {
              _cv.applyMatrix4(shellBone.matrixWorld);
              P[o] = _cv.x; P[o + 1] = _cv.y; P[o + 2] = _cv.z;
            }
          }
          if (P[o + 1] < floorY + 0.01) P[o + 1] = floorY + 0.01;
        }
      }
    }
    const g2 = this.mesh.geometry;
    g2.attributes.position.needsUpdate = true;
    g2.computeVertexNormals();
  }

  dispose() { this.char.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

// Хвост волос: цепочка частиц, отрисовка трубкой
class HairRope {
  constructor(char, material) {
    this.char = char;
    this.N = 8; this.seg = 0.042 * char.scale;
    this.pos = Array.from({ length: this.N }, () => new THREE.Vector3());
    this.prev = Array.from({ length: this.N }, () => new THREE.Vector3());
    this.local = new THREE.Vector3(0, 0.085, 0.13);
    this.R = 8;
    const vcount = this.N * this.R;
    this.vpos = new Float32Array(vcount * 3);
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) for (let r = 0; r < this.R; r++) {
      const a = i * this.R + r, b = i * this.R + (r + 1) % this.R, c = a + this.R, d = b + this.R;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.vpos, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    char.scene.add(this.mesh);
    this.needReset = true;
  }
  reset() {
    const head = this.char.bones.head;
    for (let i = 0; i < this.N; i++) {
      this.pos[i].copy(this.local).add(_cv.set(0, -i * 0.04, i * 0.015)).applyMatrix4(head.matrixWorld);
      this.prev[i].copy(this.pos[i]);
    }
    this.needReset = false;
  }
  step(dt, colliders) {
    if (this.needReset) this.reset();
    const head = this.char.bones.head;
    const root = _cw.copy(this.local).applyMatrix4(head.matrixWorld);
    if (root.distanceTo(this.pos[0]) > 1) this.reset();
    const sub = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 120)))), h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.prev[0].copy(this.pos[0]); this.pos[0].copy(root);
      for (let i = 1; i < this.N; i++) {
        const p = this.pos[i], q = this.prev[i];
        const vx = (p.x - q.x) * 0.97, vy = (p.y - q.y) * 0.97, vz = (p.z - q.z) * 0.97;
        q.copy(p); p.x += vx; p.y += vy - 9.8 * h * h; p.z += vz;
      }
      for (let it = 0; it < 4; it++) {
        for (let i = 1; i < this.N; i++) {
          const a = this.pos[i - 1], b = this.pos[i];
          _cv.subVectors(b, a);
          const d = _cv.length() || 1e-6;
          b.copy(a).addScaledVector(_cv, this.seg / d);
        }
        for (let i = 2; i < this.N; i++) for (const cl of colliders) {
          const p = this.pos[i];
          _cv.subVectors(cl.b, cl.a);
          const t = clamp(_cw.subVectors(p, cl.a).dot(_cv) / (_cv.lengthSq() + 1e-9), 0, 1);
          const cx = cl.a.x + _cv.x * t, cy = cl.a.y + _cv.y * t, cz = cl.a.z + _cv.z * t;
          const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const r = cl.r + 0.015;
          if (d < r) { p.x = cx + dx / d * r; p.y = cy + dy / d * r; p.z = cz + dz / d * r; }
        }
      }
    }
    // Трубка
    const up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    for (let i = 0; i < this.N; i++) {
      const a = this.pos[Math.max(0, i - 1)], b = this.pos[Math.min(this.N - 1, i + 1)];
      t.subVectors(b, a).normalize();
      n1.crossVectors(t, up); if (n1.lengthSq() < 1e-4) n1.set(1, 0, 0); n1.normalize();
      n2.crossVectors(t, n1).normalize();
      const r = (0.022 - 0.014 * i / (this.N - 1)) * this.char.scale;
      for (let k = 0; k < this.R; k++) {
        const ang = k / this.R * TAU, c = Math.cos(ang) * r, s = Math.sin(ang) * r, o = (i * this.R + k) * 3;
        this.vpos[o] = this.pos[i].x + n1.x * c + n2.x * s;
        this.vpos[o + 1] = this.pos[i].y + n1.y * c + n2.y * s;
        this.vpos[o + 2] = this.pos[i].z + n1.z * c + n2.z * s;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
  dispose() { this.char.scene.remove(this.mesh); }
}
