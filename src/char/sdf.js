'use strict';
// Тела и одежда описываются полями расстояний (SDF) и превращаются в сетку методом Surface Nets.
// Так получается цельная гладкая поверхность без стыков между частями тела.
const SDF = (() => {
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);

  function sphere(x, y, z, c, r) { const a = x - c[0], b = y - c[1], d = z - c[2]; return Math.sqrt(a * a + b * b + d * d) - r; }

  function ell(x, y, z, c, r) {
    const a = (x - c[0]) / r[0], b = (y - c[1]) / r[1], d = (z - c[2]) / r[2];
    const k0 = Math.sqrt(a * a + b * b + d * d);
    const a2 = a / r[0], b2 = b / r[1], d2 = d / r[2];
    const k1 = Math.sqrt(a2 * a2 + b2 * b2 + d2 * d2);
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
  }

  // Эллипсоид в собственном базисе (ax — главная ось)
  const ZERO = [0, 0, 0];
  function ellF(x, y, z, c, ax, ay, az, r) {
    const qx = x - c[0], qy = y - c[1], qz = z - c[2];
    return ell(qx * ax[0] + qy * ax[1] + qz * ax[2], qx * ay[0] + qy * ay[1] + qz * ay[2], qx * az[0] + qy * az[1] + qz * az[2], ZERO, r);
  }

  // Конус со скруглёнными концами (I. Quilez): радиус r1 в точке a, r2 в точке b
  function rcone(x, y, z, a, b, r1, r2) {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yv = pax * bax + pay * bay + paz * baz, zv = yv - l2;
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yv * yv * l2, z2 = zv * zv * l2;
    const k = (rr > 0 ? 1 : rr < 0 ? -1 : 0) * rr * rr * x2;
    if ((zv > 0 ? 1 : zv < 0 ? -1 : 0) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if ((yv > 0 ? 1 : yv < 0 ? -1 : 0) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
  }

  function capsule(x, y, z, a, b, r) { return rcone(x, y, z, a, b, r, r); }

  // Параметр проекции точки на отрезок (0..1) и расстояние до него
  function segT(x, y, z, a, b) {
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const t = ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  function segD(x, y, z, a, b) {
    const t = segT(x, y, z, a, b);
    const dx = x - a[0] - (b[0] - a[0]) * t, dy = y - a[1] - (b[1] - a[1]) * t, dz = z - a[2] - (b[2] - a[2]) * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Шум значений для складок ткани и прядей
  function hash(i, j, k) {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) & 0xffff) / 65535;
  }
  function noise(x, y, z) {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const fx = x - i, fy = y - j, fz = z - k;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(hash(i, j, k), hash(i + 1, j, k), u), l(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
      l(l(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), l(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v), w) * 2 - 1;
  }

  const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------- Surface Nets ----------
  // Сначала грубая сетка, точные значения считаются только у поверхности (узкая полоса).
  const stats = { islands: 0, removedTris: 0 };
  // Связные компоненты по общим вершинам; компоненты меньше minTris треугольников выбрасываем
  function dropIslands(ind, nv, minTris) {
    const parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (let t = 0; t < ind.length; t += 3) { unite(ind[t], ind[t + 1]); unite(ind[t], ind[t + 2]); }
    const count = new Map();
    for (let t = 0; t < ind.length; t += 3) { const r = find(ind[t]); count.set(r, (count.get(r) || 0) + 1); }
    const out = [];
    for (let t = 0; t < ind.length; t += 3) if (count.get(find(ind[t])) >= minTris) out.push(ind[t], ind[t + 1], ind[t + 2]);
    let small = 0; for (const c of count.values()) if (c < minTris) small++;
    stats.islands += small; stats.removedTris += (ind.length - out.length) / 3;
    return out;
  }

  function mesh(f, min, max, h, colorFn) {
    const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
    const N = nx * ny * nz, idx = (i, j, k) => i + nx * (j + ny * k);
    const v = new Float32Array(N);
    const C = 4;
    const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
    const cv = new Float32Array(cx * cy * cz), cidx = (i, j, k) => i + cx * (j + cy * k);
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      cv[cidx(i, j, k)] = f(min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h);
    }
    const band = C * h * 1.9;
    const done = new Uint8Array(N);
    for (let ck = 0; ck < cz - 1; ck++) for (let cj = 0; cj < cy - 1; cj++) for (let ci = 0; ci < cx - 1; ci++) {
      const c000 = cv[cidx(ci, cj, ck)], c100 = cv[cidx(ci + 1, cj, ck)], c010 = cv[cidx(ci, cj + 1, ck)], c110 = cv[cidx(ci + 1, cj + 1, ck)];
      const c001 = cv[cidx(ci, cj, ck + 1)], c101 = cv[cidx(ci + 1, cj, ck + 1)], c011 = cv[cidx(ci, cj + 1, ck + 1)], c111 = cv[cidx(ci + 1, cj + 1, ck + 1)];
      const near = Math.min(Math.abs(c000), Math.abs(c100), Math.abs(c010), Math.abs(c110), Math.abs(c001), Math.abs(c101), Math.abs(c011), Math.abs(c111)) < band;
      for (let k = ck * C; k <= Math.min((ck + 1) * C, nz - 1); k++) for (let j = cj * C; j <= Math.min((cj + 1) * C, ny - 1); j++) for (let i = ci * C; i <= Math.min((ci + 1) * C, nx - 1); i++) {
        const id = idx(i, j, k);
        if (done[id]) continue;
        done[id] = 1;
        if (near) v[id] = f(min[0] + i * h, min[1] + j * h, min[2] + k * h);
        else {
          const u = (i - ci * C) / C, w = (j - cj * C) / C, s = (k - ck * C) / C;
          const a = c000 + (c100 - c000) * u, b = c010 + (c110 - c010) * u, c = c001 + (c101 - c001) * u, d = c011 + (c111 - c011) * u;
          const e = a + (b - a) * w, g = c + (d - c) * w;
          v[id] = e + (g - e) * s;
        }
      }
    }

    const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cellId = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
    const pos = [];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv8 = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const val = v[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
        cv8[c] = val;
        if (val < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) {
        const va = cv8[a], vb = cv8[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + ((b & 1) - (a & 1)) * t;
        sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
        sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
        n++;
      }
      cellV[cellId(i, j, k)] = pos.length / 3;
      pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
    }

    const ind = [];
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) ind.push(a, c, b, a, d, c); else ind.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const v0 = v[idx(i, j, k)], in0 = v0 < 0;
      if (in0 !== (v[idx(i + 1, j, k)] < 0)) quad(cellV[cellId(i, j - 1, k - 1)], cellV[cellId(i, j, k - 1)], cellV[cellId(i, j, k)], cellV[cellId(i, j - 1, k)], in0);
      if (in0 !== (v[idx(i, j + 1, k)] < 0)) quad(cellV[cellId(i - 1, j, k - 1)], cellV[cellId(i - 1, j, k)], cellV[cellId(i, j, k)], cellV[cellId(i, j, k - 1)], in0);
      if (in0 !== (v[idx(i, j, k + 1)] < 0)) quad(cellV[cellId(i - 1, j - 1, k)], cellV[cellId(i, j - 1, k)], cellV[cellId(i, j, k)], cellV[cellId(i - 1, j, k)], in0);
    }

    // Нормали по градиенту поля (тетраэдрическая схема, 4 вычисления)
    const nv = pos.length / 3;
    const nor = new Float32Array(nv * 3), P = new Float32Array(pos);
    const e = h * 0.5;
    for (let q = 0; q < nv; q++) {
      const x = P[q * 3], y = P[q * 3 + 1], z = P[q * 3 + 2];
      const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
      const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
      const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      nor[q * 3] = gx / l; nor[q * 3 + 1] = gy / l; nor[q * 3 + 2] = gz / l;
    }
    // Ориентация треугольников по нормалям
    for (let t = 0; t < ind.length; t += 3) {
      const a = ind[t] * 3, b = ind[t + 1] * 3, c = ind[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
      if (fx * nor[a] + fy * nor[a + 1] + fz * nor[a + 2] < 0) { const tmp = ind[t + 1]; ind[t + 1] = ind[t + 2]; ind[t + 2] = tmp; }
    }
    let col = null;
    if (colorFn) {
      col = new Float32Array(nv * 3);
      const out = [0, 0, 0];
      for (let q = 0; q < nv; q++) {
        colorFn(P[q * 3], P[q * 3 + 1], P[q * 3 + 2], nor[q * 3], nor[q * 3 + 1], nor[q * 3 + 2], out);
        col[q * 3] = out[0]; col[q * 3 + 1] = out[1]; col[q * 3 + 2] = out[2];
      }
    }
    // Убираем мелкие оторванные кусочки (кончики тонких деталей, распавшиеся на крошки)
    const cleanInd = dropIslands(ind, nv, 40);
    return { positions: P, normals: nor, colors: col, indices: nv > 65535 ? new Uint32Array(cleanInd) : new Uint16Array(cleanInd) };
  }

  return { smin, smax, sphere, ell, ellF, rcone, capsule, segT, segD, noise, smooth01, mesh, stats };
})();
