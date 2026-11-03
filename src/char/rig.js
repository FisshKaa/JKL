'use strict';
// Скелет: суставы в «A-позе», модельное пространство (y вверх, вперёд −z, пол y = 0).
const RIG_BONES = ['hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'foreArmL', 'handL', 'clavR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const RIG_PARENT = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', upperArmL: 'clavL', foreArmL: 'upperArmL', handL: 'foreArmL',
  clavR: 'chest', upperArmR: 'clavR', foreArmR: 'upperArmR', handR: 'foreArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};
const BONE_INDEX = Object.fromEntries(RIG_BONES.map((b, i) => [b, i]));

function rigJoints(look) {
  const f = look.sex === 'f' ? 1 : 0;
  const v = (x, y, z) => [x, y, z];
  const add = (a, d, s) => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
  const J = {
    hips: v(0, 0.98, 0), spine: v(0, 1.08, 0.004), chest: v(0, 1.28, 0.004),
    neck: v(0, 1.46, 0.012), head: v(0, 1.58, 0.012),
  };
  J.eyeLocal = v(0, 0.094, -0.078);
  J.eye = add(J.head, J.eyeLocal, 1);
  for (const [S, s] of [['R', 1], ['L', -1]]) {
    const dir = norm3([0.62 * s, -0.78, -0.05]);
    J['clav' + S] = v(0.025 * s, 1.43, 0.004);
    J['sh' + S] = v((0.18 - 0.017 * f) * s, 1.425, 0.012);
    J['el' + S] = add(J['sh' + S], dir, 0.285 - 0.01 * f);
    J['wr' + S] = add(J['el' + S], dir, 0.255 - 0.01 * f);
    J['hand' + S] = add(J['wr' + S], dir, 0.085);
    J['armDir' + S] = dir;
    J['hip' + S] = v((0.092 + 0.01 * f) * s, 0.94, 0.0);
    J['kn' + S] = v((0.096 + 0.004 * f) * s, 0.505, -0.006);
    J['an' + S] = v((0.1 + 0.002 * f) * s, 0.085, 0.02);
    J['toe' + S] = v((0.1 + 0.002 * f) * s, 0.02, -0.125);
  }
  // Положения костей
  J.bone = {
    hips: J.hips, spine: J.spine, chest: J.chest, neck: J.neck, head: J.head,
    clavL: J.clavL, upperArmL: J.shL, foreArmL: J.elL, handL: J.wrL,
    clavR: J.clavR, upperArmR: J.shR, foreArmR: J.elR, handR: J.wrR,
    thighL: J.hipL, shinL: J.knL, footL: J.anL, thighR: J.hipR, shinR: J.knR, footR: J.anR,
  };
  // Отрезки костей для весов скиннинга
  J.seg = {
    hips: [v(0, 0.9, 0.01), v(0, 1.05, 0)], spine: [v(0, 1.05, 0), v(0, 1.24, 0)], chest: [v(0, 1.24, 0), v(0, 1.44, 0.01)],
    neck: [v(0, 1.44, 0.012), v(0, 1.58, 0.012)], head: [v(0, 1.58, 0.012), v(0, 1.76, 0.012)],
    clavL: [J.clavL, J.shL], upperArmL: [J.shL, J.elL], foreArmL: [J.elL, J.wrL], handL: [J.wrL, J.handL],
    clavR: [J.clavR, J.shR], upperArmR: [J.shR, J.elR], foreArmR: [J.elR, J.wrR], handR: [J.wrR, J.handR],
    thighL: [J.hipL, J.knL], shinL: [J.knL, J.anL], footL: [J.anL, J.toeL],
    thighR: [J.hipR, J.knR], shinR: [J.knR, J.anR], footR: [J.anR, J.toeR],
  };
  return J;
}

// Веса скиннинга: до 4 ближайших костей, без перетекания между левой и правой стороной
function skinWeights(J, positions) {
  const n = positions.length / 3;
  const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
  const bones = RIG_BONES.map((b, i) => ({ i, side: b.endsWith('L') ? -1 : b.endsWith('R') ? 1 : 0, arm: /Arm|hand|clav/.test(b), leg: /thigh|shin|foot/.test(b), clav: /clav/.test(b), seg: J.seg[b] }));
  const bi = [0, 0, 0, 0], bd = [0, 0, 0, 0];
  for (let q = 0; q < n; q++) {
    const x = positions[q * 3], y = positions[q * 3 + 1], z = positions[q * 3 + 2];
    bd[0] = bd[1] = bd[2] = bd[3] = 99;
    for (let b = 0; b < bones.length; b++) {
      const B = bones[b];
      if (B.side !== 0 && B.side * x < -0.015) continue;
      if (B.leg && y > 1.02) continue;
      let dist = SDF.segD(x, y, z, B.seg[0], B.seg[1]);
      if (B.arm && Math.abs(x) < 0.12 && !B.clav) dist += 0.08;
      if (dist >= bd[3]) continue;
      let k = 3;
      while (k > 0 && bd[k - 1] > dist) { bd[k] = bd[k - 1]; bi[k] = bi[k - 1]; k--; }
      bd[k] = dist; bi[k] = b;
    }
    let sum = 0;
    for (let k = 0; k < 4; k++) { const dd = bd[k] * bd[k] + 1e-5; const v = bd[k] > 50 ? 0 : 1 / (dd * dd * Math.sqrt(dd) ** 0.4); bd[k] = v; sum += v; }
    for (let k = 0; k < 4; k++) { idx[q * 4 + k] = bi[k]; wt[q * 4 + k] = sum > 0 ? bd[k] / sum : (k === 0 ? 1 : 0); }
  }
  return { skinIndex: idx, skinWeight: wt };
}

// ---------- Внешность ----------
const SKIN_TONES = ['#f2d6bd', '#e3b896', '#c9946c', '#a26c48', '#6e452e', '#4a2f22', '#9fb3d6', '#9cb39f'];
const HAIR_COLORS = ['#1b1410', '#3a2618', '#5a3a22', '#7f5a36', '#b08a5a', '#d8c39a', '#8c8c8c', '#6e2a1e'];
const EYE_COLORS = ['#4a3324', '#6b8a5a', '#4f7aa8', '#7a6a4a', '#3a3a3a'];

const LOOK_PRESETS = {
  keeper: {
    name: 'Хранитель', style: 'soresu', sex: 'm', height: 0.55, build: 0.5, skin: '#e3b896', face: 1, eyes: '#4f7aa8',
    hair: 'short', hairColor: '#5a3a22', beard: 'full',
    top: 'tunic', tails: true, sash: true, wraps: false, armor: 'none', outer: 'robe',
    colors: { tunic: '#c9b58f', under: '#e2d6bd', sash: '#8a6a45', belt: '#3a2618', trousers: '#9a8462', boots: '#2b201a', outer: '#5a3e28', armor: '#e9e7e1' },
  },
  guard: {
    name: 'Страж', style: 'djemso', sex: 'm', height: 0.6, build: 0.7, skin: '#c9946c', face: 2, eyes: '#4a3324',
    hair: 'short', hairColor: '#1b1410', beard: 'stubble',
    top: 'vest', tails: true, sash: false, wraps: false, armor: 'light', outer: 'none',
    colors: { tunic: '#cdb994', under: '#1e1c1e', sash: '#5a4630', belt: '#3d2a1c', trousers: '#1e1c1e', boots: '#e9e7e1', outer: '#3a2a20', armor: '#e9e7e1' },
  },
  wanderer: {
    name: 'Странник', style: 'juyo', sex: 'm', height: 0.65, build: 0.55, skin: '#e3b896', face: 0, eyes: '#4a3324',
    hair: 'slick', hairColor: '#3a2618', beard: 'none',
    top: 'tunic', tails: false, sash: true, wraps: false, armor: 'none', outer: 'robe',
    colors: { tunic: '#6e2a20', under: '#3a1a16', sash: '#4a1c16', belt: '#22160f', trousers: '#2a1c18', boots: '#1c1410', outer: '#1d1a1c', armor: '#e9e7e1' },
  },
  scout: {
    name: 'Разведчица', style: 'ataru', sex: 'f', height: 0.4, build: 0.35, skin: '#f2d6bd', face: 0, eyes: '#6b8a5a',
    hair: 'pony', hairColor: '#5a3a22', beard: 'none',
    top: 'tunic', tails: false, sash: true, wraps: true, armor: 'none', outer: 'cape',
    colors: { tunic: '#6a4a30', under: '#a8452e', sash: '#8a6a3a', belt: '#3a2618', trousers: '#3b2c22', boots: '#2b201a', outer: '#2f2620', armor: '#e9e7e1' },
  },
};

function cloneLook(l) { return JSON.parse(JSON.stringify(l)); }

function randomLook() {
  const keys = Object.keys(LOOK_PRESETS);
  const L = cloneLook(LOOK_PRESETS[keys[randInt(keys.length)]]);
  L.skin = SKIN_TONES[randInt(6)];
  L.hairColor = HAIR_COLORS[randInt(HAIR_COLORS.length)];
  L.eyes = EYE_COLORS[randInt(EYE_COLORS.length)];
  L.face = randInt(3);
  L.style = STYLE_IDS[randInt(STYLE_IDS.length)];
  L.height = rand(0.3, 0.8); L.build = rand(0.3, 0.8);
  if (L.sex === 'm') { L.beard = ['none', 'stubble', 'full'][randInt(3)]; L.hair = ['short', 'slick', 'long', 'bald'][randInt(4)]; }
  else L.hair = ['pony', 'long', 'short'][randInt(3)];
  return L;
}

// Рост: слайдер 0..1 → масштаб модели
const lookScale = l => (l.sex === 'f' ? 0.94 : 1) * (0.95 + 0.1 * l.height);
