'use strict';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const chance = p => Math.random() < p;
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// Отражение угла для бойца, смотрящего влево. Инволюция: работает в обе стороны.
function mirrorAngle(a, facing) {
  return facing >= 0 ? a : Math.PI - a;
}

// Ближайшие точки двух отрезков (Ericson, Real-Time Collision Detection)
function closestSegSeg(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y;
  const rx = p1.x - p2.x, ry = p1.y - p2.y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-8;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const x1 = p1.x + d1x * s, y1 = p1.y + d1y * s;
  const x2 = p2.x + d2x * t, y2 = p2.y + d2y * t;
  return { dist: Math.hypot(x1 - x2, y1 - y2), s, t, x1, y1, x2, y2 };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const rgba = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;
