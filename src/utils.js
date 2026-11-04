'use strict';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = n => (Math.random() * n) | 0;
const chance = p => Math.random() < p;
const approach = (v, t, s) => (v < t ? Math.min(v + s, t) : Math.max(v - s, t));
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
function turnToward(a, target, step) {
  const d = wrapAngle(target - a);
  return Math.abs(d) <= step ? target : wrapAngle(a + Math.sign(d) * step);
}

// Ориентация: yaw = 0 смотрит в −Z, как камера three.js
const yawTo = (a, b) => Math.atan2(a.x - b.x, a.z - b.z);
const fwdOf = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const rightOf = yaw => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

const NOOP = new Proxy({}, { get: () => () => {} });
