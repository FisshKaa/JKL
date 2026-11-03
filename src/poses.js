'use strict';
// Позы задаются в пространстве головы бойца: x вправо, y вверх, z назад (вперёд — минус z).
// h — положение кисти, d — направление клинка. Одни и те же таблицы используются
// для вида от первого лица и для модели противника.
const P = (hx, hy, hz, dx, dy, dz) => ({ h: [hx, hy, hz], d: norm3([dx, dy, dz]) });

const POSES = {
  //       верх                                 право                                низ                                  лево
  guard:  [P(0.22, 0.02, -0.42, -0.15, 1, 0.25), P(0.34, -0.18, -0.42, 0.55, 0.8, 0.05), P(0.26, -0.42, -0.4, 0.35, -0.55, -0.75), P(-0.12, -0.18, -0.42, -0.6, 0.75, 0.05)],
  windup: [P(0.18, 0.12, -0.3, -0.1, 0.6, 0.8),    P(0.45, -0.12, -0.3, 0.8, 0.35, 0.45),  P(0.32, -0.5, -0.3, 0.45, -0.5, 0.75),    P(-0.25, -0.12, -0.3, -0.8, 0.35, 0.45)],
  mid:    [P(0.1, -0.08, -0.6, 0, 0.55, -0.85),    P(0.15, -0.2, -0.62, -0.1, 0.15, -1),   P(0.12, -0.32, -0.62, 0, -0.1, -1),       P(0.0, -0.2, -0.62, 0.1, 0.15, -1)],
  end:    [P(0.05, -0.42, -0.5, 0.05, -0.75, -0.6), P(-0.2, -0.28, -0.5, -0.9, -0.1, -0.4), P(0.05, 0.05, -0.55, -0.25, 0.85, -0.45),  P(0.38, -0.3, -0.5, 0.9, -0.1, -0.4)],
  block:  [P(0.3, 0.08, -0.45, -1, 0.18, -0.15),  P(0.32, -0.3, -0.45, 0.12, 1, -0.2),    P(0.3, -0.35, -0.45, -0.9, -0.45, -0.25), P(-0.15, -0.3, -0.45, -0.12, 1, -0.2)],
  bind: P(0.08, -0.2, -0.45, -0.35, 0.85, -0.6),
};

function mixPose(a, b, t) {
  return { h: lerp3(a.h, b.h, t), d: norm3(lerp3(a.d, b.d, t)) };
}

// Целевая поза по состоянию бойца
function targetPose(f, time) {
  const st = f.stateT, a = f.attack;
  if (f.dead) return POSES.guard[DIR.DOWN];
  switch (f.state) {
    case 'windup':
    case 'strike': {
      const dir = a.dir, W = a.windup;
      const u = f.state === 'windup' ? st : W + st;
      const s0 = Math.max(W * 0.55, W - CFG.SWEEP_PRE);
      if (u < s0) return mixPose(POSES.guard[dir], POSES.windup[dir], easeOut(u / s0));
      if (a.blocked && f.state === 'strike') return mixPose(POSES.mid[dir], POSES.windup[dir], (st / CFG.STRIKE) * 0.45);
      const k = clamp((u - s0) / (W + CFG.STRIKE - s0), 0, 1);
      return k < 0.5 ? mixPose(POSES.windup[dir], POSES.mid[dir], k * 2) : mixPose(POSES.mid[dir], POSES.end[dir], (k - 0.5) * 2);
    }
    case 'recover': {
      if (!a) return POSES.guard[f.stance];
      const from = a.blocked ? mixPose(POSES.mid[a.dir], POSES.windup[a.dir], 0.45) : POSES.end[a.dir];
      return mixPose(from, POSES.guard[f.stance], easeInOut(clamp(st / f.dur, 0, 1)));
    }
    case 'feint':
      return mixPose(POSES.windup[a.dir], POSES.guard[f.stance], clamp(st / f.dur, 0, 1));
    case 'bind': {
      const j = Math.sin(time * 37) * 0.012, p = POSES.bind;
      return { h: [p.h[0] + j, p.h[1] + j * 0.5, p.h[2]], d: p.d };
    }
    case 'stagger': {
      const g = POSES.guard[f.stance], k = Math.sin(clamp(st / f.dur, 0, 1) * Math.PI);
      return { h: [g.h[0] + 0.12 * k, g.h[1] + 0.1 * k, g.h[2] + 0.18 * k], d: norm3([g.d[0] + 0.4 * k, g.d[1], g.d[2] + 0.6 * k]) };
    }
    default:
      return f.blocking ? POSES.block[f.stance] : POSES.guard[f.stance];
  }
}

// Плавное следование позы за целью + скорость клинка (для звука и шлейфа)
class PoseAnim {
  constructor() { this.cur = { h: [...POSES.guard[0].h], d: [...POSES.guard[0].d] }; this.speed = 0; }
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
