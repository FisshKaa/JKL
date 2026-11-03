'use strict';
// Позы задаются в пространстве головы бойца: x вправо, y вверх, z назад (вперёд — минус z).
// h — положение кисти, d — направление клинка. Одни и те же таблицы используются
// и для вида от первого лица, и для модели бойца.
const P = (hx, hy, hz, dx, dy, dz) => ({ h: [hx, hy, hz], d: norm3([dx, dy, dz]) });

// Порядок: верх, право, низ-право, низ-лево, лево
const POSES = {
  guard: [
    P(0.22, 0.02, -0.42, -0.15, 1, 0.25),
    P(0.34, -0.18, -0.42, 0.55, 0.8, 0.05),
    P(0.28, -0.34, -0.42, 0.4, -0.45, -0.8),
    P(-0.08, -0.34, -0.42, -0.45, -0.45, -0.8),
    P(-0.12, -0.18, -0.42, -0.6, 0.75, 0.05),
    P(0.2, -0.22, -0.42, 0.05, 0.25, -1),      // укол: клинок вперёд
  ],
  windup: [
    P(0.18, 0.12, -0.3, -0.1, 0.6, 0.8),
    P(0.45, -0.12, -0.3, 0.8, 0.35, 0.45),
    P(0.36, -0.5, -0.3, 0.5, -0.5, 0.7),
    P(-0.2, -0.5, -0.3, -0.5, -0.5, 0.7),
    P(-0.25, -0.12, -0.3, -0.8, 0.35, 0.45),
    P(0.24, -0.3, -0.18, 0.02, 0.12, -1),       // укол: кисть оттянута к бедру
  ],
  mid: [
    P(0.1, -0.08, -0.6, 0, 0.55, -0.85),
    P(0.15, -0.2, -0.62, -0.1, 0.15, -1),
    P(0.14, -0.3, -0.62, -0.15, 0.1, -1),
    P(0.06, -0.3, -0.62, 0.15, 0.1, -1),
    P(0.0, -0.2, -0.62, 0.1, 0.15, -1),
    P(0.1, -0.2, -0.7, 0, 0.06, -1),
  ],
  end: [
    P(0.05, -0.42, -0.5, 0.05, -0.75, -0.6),
    P(-0.2, -0.28, -0.5, -0.9, -0.1, -0.4),
    P(-0.08, 0.02, -0.55, -0.45, 0.8, -0.4),   // низ-право: восходящий рез вверх-влево
    P(0.3, 0.02, -0.55, 0.45, 0.8, -0.4),      // низ-лево: восходящий рез вверх-вправо
    P(0.38, -0.3, -0.5, 0.9, -0.1, -0.4),
    P(0.06, -0.18, -0.8, 0, 0.03, -1),
  ],
  block: [
    P(0.3, 0.08, -0.45, -1, 0.18, -0.15),
    P(0.32, -0.3, -0.45, 0.12, 1, -0.2),
    P(0.3, -0.28, -0.45, 0.25, -1, -0.25),
    P(-0.12, -0.28, -0.45, -0.25, -1, -0.25),
    P(-0.15, -0.3, -0.45, -0.12, 1, -0.2),
    P(0.32, -0.3, -0.45, 0.12, 1, -0.2),
  ],
  bind: P(0.08, -0.2, -0.45, -0.35, 0.85, -0.6),
  mantle: P(0.3, -0.35, -0.3, 0.3, -0.8, 0.4),
};

function mixPose(a, b, t) {
  return { h: lerp3(a.h, b.h, t), d: norm3(lerp3(a.d, b.d, t)) };
}

// ---------- Почерк формы боя ----------
const _H0 = [0.12, -0.2, -0.36];
const hash1 = n => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

// Замах формы: размах, высота (Джем-Со), горизонт (Шии-Чо), компактность (Соресу)
function styleWindup(SP, dir, G) {
  let w = mixPose(G, POSES.windup[dir], SP.windScale || 1);
  const side = dir !== DIR.UP && dir !== DIR.THRUST;
  if (SP.flat && side) { w = { h: [w.h[0] * (1 + 0.25 * SP.flat), lerp(w.h[1], -0.12, 0.5 * SP.flat), w.h[2]], d: norm3([w.d[0] * (1 + 0.4 * SP.flat), w.d[1] * (1 - 0.7 * SP.flat), w.d[2]]) }; }
  if (SP.raise && dir !== DIR.THRUST) { const r = SP.raise; w = { h: [w.h[0] * 0.8, w.h[1] + 0.2 * r, w.h[2] + 0.08 * r], d: norm3([w.d[0] * 0.6, w.d[1] + 0.7 * r, w.d[2] + 0.5 * r]) }; }
  if (SP.compact) w = { h: lerp3(w.h, _H0, 0.35 * SP.compact), d: w.d };
  return w;
}
// Проводка формы: длинная (Шии-Чо, Атару), короткая (Соресу, Макаши), рубящая вниз (Джем-Со)
function styleEnd(SP, dir) {
  let e = mixPose(POSES.mid[dir], POSES.end[dir], SP.endScale || 1);
  const side = dir !== DIR.UP && dir !== DIR.THRUST;
  if (SP.flat && side) e = { h: [e.h[0] * (1 + 0.3 * SP.flat), lerp(e.h[1], -0.18, 0.5 * SP.flat), e.h[2]], d: norm3([e.d[0], e.d[1] * (1 - 0.7 * SP.flat), e.d[2]]) };
  if (SP.downBias && dir !== DIR.THRUST) e = { h: [e.h[0], e.h[1] - 0.12 * SP.downBias, e.h[2]], d: norm3([e.d[0], e.d[1] - 0.6 * SP.downBias, e.d[2]]) };
  if (SP.compact) e = { h: lerp3(e.h, _H0, 0.35 * SP.compact), d: e.d };
  return e;
}

// Поза с учётом формы боя
function targetPose(f, time) {
  const ST = (typeof styleOf === 'function' ? styleOf(f) : null);
  const SP = ST ? ST.pose : { home: null, pull: 0, windScale: 1, sway: 0 };
  const G = i => (SP.home && i < NDIR ? mixPose(POSES.guard[i], SP.home, SP.pull) : POSES.guard[i]);
  const Wd = i => styleWindup(SP, i, G(i === DIR.THRUST ? f.stance : i));
  const En = i => styleEnd(SP, i);
  // Кистевая работа (Макаши): рука почти стоит у стойки, клинок поворачивает кисть
  const wristy = (p, dir) => (SP.wrist ? { h: lerp3(p.h, G(dir === DIR.THRUST ? f.stance : dir).h, SP.wrist), d: p.d } : p);
  const st = f.stateT, a = f.attack;
  if (f.dead) return POSES.guard[DIR.DOWN_RIGHT];
  switch (f.state) {
    case 'windup':
    case 'strike': {
      if (!a) return G(f.stance);
      const dir = a.dir, W = a.windup;
      const u = f.state === 'windup' ? st : W + st;
      const s0 = Math.max(W * 0.55, W - CFG.SWEEP_PRE);
      const G0 = G(dir === DIR.THRUST ? f.stance : dir);
      if (u < s0) {
        let k = u / s0;
        // Джуйо: рывок — быстро взвёл и замер, потом взрыв
        if (SP.staccato) k = k < 0.4 ? k * 2.1 : 0.84 + (k - 0.4) * 0.27;
        let w = mixPose(G0, Wd(dir), easeOut(clamp(k, 0, 1)));
        if (a.heavy) { const hk = clamp((u - s0 * 0.4) / (s0 * 0.6), 0, 1) * 0.6; w.h = [w.h[0] * (1 + 0.25 * hk), w.h[1] + 0.06 * hk, w.h[2] + 0.12 * hk]; }
        return wristy(w, dir);
      }
      if (a.blocked && f.state === 'strike') return wristy(mixPose(POSES.mid[dir], Wd(dir), (st / CFG.STRIKE) * 0.45), dir);
      const k = clamp((u - s0) / (W + CFG.STRIKE - s0), 0, 1);
      let p = k < 0.5 ? mixPose(Wd(dir), POSES.mid[dir], k * 2) : mixPose(POSES.mid[dir], En(dir), (k - 0.5) * 2);
      if (SP.jitter && dir !== DIR.THRUST) {
        // Джуйо: зигзаг посреди удара — траектория ломается
        const sgn = isLeftSide(dir) ? -1 : 1, z = Math.sin(k * TAU * 1.5) * SP.jitter;
        p = { h: [p.h[0] + z * 0.09 * sgn, p.h[1] + Math.cos(k * TAU) * 0.05 * SP.jitter, p.h[2]], d: norm3([p.d[0] + z * 0.35 * sgn, p.d[1], p.d[2]]) };
      }
      return wristy(p, dir);
    }
    case 'recover': {
      if (!a) return G(f.stance);
      const from = a.blocked ? mixPose(POSES.mid[a.dir], Wd(a.dir), 0.45) : En(a.dir);
      return wristy(mixPose(from, G(f.stance), easeInOut(clamp(st / f.dur, 0, 1))), a.dir);
    }
    case 'feint':
      if (!a) return G(f.stance);
      return mixPose(Wd(a.dir), G(f.stance), clamp(st / f.dur, 0, 1));
    case 'bind': {
      const j = Math.sin(time * 37) * 0.012, p = POSES.bind;
      return { h: [p.h[0] + j, p.h[1] + j * 0.5, p.h[2]], d: p.d };
    }
    case 'push':
    case 'kick':
    case 'pull':
      return G(f.stance);
    case 'vault':
    case 'hang':
    case 'climb':
      return POSES.mantle;
    case 'stagger': {
      const g = G(f.stance), k = Math.sin(clamp(st / f.dur, 0, 1) * Math.PI);
      return { h: [g.h[0] + 0.12 * k, g.h[1] + 0.1 * k, g.h[2] + 0.18 * k], d: norm3([g.d[0] + 0.4 * k, g.d[1], g.d[2] + 0.6 * k]) };
    }
    default: {
      if (f.blocking) {
        const b = SP.home ? mixPose(POSES.block[f.stance], SP.home, SP.pull * 0.2) : POSES.block[f.stance];
        return SP.compact ? { h: lerp3(b.h, _H0, 0.25 * SP.compact), d: b.d } : b;
      }
      let g = G(f.stance);
      const ph = time + f.index * 2;
      if (SP.weave) {
        // Соресу: клинок непрерывно описывает восьмёрку у тела — «держи клинок в движении»
        const w = SP.weave;
        g = { h: [g.h[0] + Math.cos(ph * 3.2) * 0.04 * w, g.h[1] + Math.sin(ph * 6.4) * 0.025 * w, g.h[2]], d: norm3([g.d[0] + Math.sin(ph * 3.2) * 0.35 * w, g.d[1], g.d[2] + Math.cos(ph * 6.4) * 0.12 * w]) };
      }
      if (SP.twitch) {
        // Джуйо: стойка дёргается рывками в случайные стороны
        const n = Math.floor(ph * 1.8), k = clamp((ph * 1.8 - n) * 5, 0, 1);
        const ox = lerp(hash1(n) - 0.5, hash1(n + 1) - 0.5, easeOut(k)), oy = lerp(hash1(n + 7) - 0.5, hash1(n + 8) - 0.5, easeOut(k));
        g = { h: [g.h[0] + ox * 0.12 * SP.twitch, g.h[1] + oy * 0.1 * SP.twitch, g.h[2]], d: norm3([g.d[0] + ox * 0.6 * SP.twitch, g.d[1] + oy * 0.4, g.d[2]]) };
      }
      const sw = (SP.sway || 0) * 0.03;
      if (sw) g = { h: [g.h[0] + Math.sin(ph * 1.7) * sw, g.h[1] + Math.sin(ph * 2.2) * sw * 0.7, g.h[2]], d: norm3([g.d[0] + Math.sin(ph * 1.36) * sw * 2, g.d[1], g.d[2]]) };
      return g;
    }
  }
}

// Плавное следование позы за целью + скорость клинка (для звука и шлейфа)
class PoseAnim {
  constructor() { this.cur = { h: [...POSES.guard[1].h], d: [...POSES.guard[1].d] }; this.speed = 0; }
  update(f, time, dt) {
    const tgt = targetPose(f, time);
    const fast = f.state === 'windup' || f.state === 'strike';
    const k = 1 - Math.exp(-(fast ? 40 : 15) * dt);
    const prevD = this.cur.d;
    this.cur = { h: lerp3(this.cur.h, tgt.h, k), d: norm3(lerp3(this.cur.d, tgt.d, k)) };
    const dd = Math.hypot(this.cur.d[0] - prevD[0], this.cur.d[1] - prevD[1], this.cur.d[2] - prevD[2]);
    this.speed = lerp(this.speed, dt > 0 ? dd / dt : 0, 0.3);
    return this.cur;
  }
}
