'use strict';
// Бот выдаёт тот же input, что и игрок — никаких читов, только задержка восприятия и решения.
const BOT_LEVELS = {
  easy:   { title: 'Ученик', reaction: 0.30, aggression: 0.45, block: 0.35, windup: [0.30, 0.42], push: 0.25, power: 0.1,  spacing: 165, dodge: 0.05, recovery: 0.5 },
  normal: { title: 'Рыцарь', reaction: 0.17, aggression: 0.70, block: 0.62, windup: [0.20, 0.32], push: 0.50, power: 0.35, spacing: 155, dodge: 0.2,  recovery: 0.85 },
  hard:   { title: 'Мастер', reaction: 0.09, aggression: 0.95, block: 0.88, windup: [0.12, 0.22], push: 0.80, power: 0.6,  spacing: 148, dodge: 0.4,  recovery: 1 },
};

// Удары в «локальных» углах бойца, смотрящего вправо (0 — вперёд, минус — вверх).
// dir: направление вращения, over: насколько клинок проходит дальше линии на соперника.
const SWINGS = [
  { wind: -2.1, dir: 1, over: 0.8 },   // сверху вниз
  { wind: 2.1, dir: -1, over: -0.8 },  // снизу вверх
  { wind: -1.3, dir: 1, over: 1.3 },   // диагональ
  { wind: 1.2, dir: -1, over: -1.2 },  // подрез
];

class BotController {
  constructor(level = 'normal') {
    this.level = level;
    this.p = BOT_LEVELS[level];
    this.roundId = -1;
    this.reset();
  }

  reset() {
    this.mode = 'neutral'; this.modeT = 0;
    this.cd = rand(0.5, 1.2); this.t = rand(0, 10);
    this.perc = null; this.threatSeen = false; this.blockRoll = false;
    this.wander = 0; this.wanderT = 0; this.swing = SWINGS[0]; this.usePower = false; this.jumpCd = 0;
  }

  setMode(m, t = 0) { this.mode = m; this.modeT = t; }

  startSwing(windT) {
    this.swing = SWINGS[(Math.random() * SWINGS.length) | 0];
    this.usePower = chance(this.p.power);
    this.setMode('windup', windT);
  }

  getInput(me, opp, game, dt) {
    const p = this.p;
    const out = { move: 0, jump: false, down: false, dash: false, push: false, power: false, aim: me.aim };
    if (this.roundId !== game.roundId) { this.reset(); this.roundId = game.roundId; }
    if (!game.controlsEnabled || !me.alive) return out;

    this.t += dt; this.cd -= dt; this.modeT -= dt; this.wanderT -= dt; this.jumpCd -= dt;

    // Восприятие с задержкой: бот «видит» чужой клинок с опозданием
    const ob = opp.blade();
    if (!this.perc) this.perc = { tx: ob.tip.x, ty: ob.tip.y };
    const k = 1 - Math.exp(-dt / p.reaction);
    this.perc.tx += (ob.tip.x - this.perc.tx) * k;
    this.perc.ty += (ob.tip.y - this.perc.ty) * k;

    const dx = opp.x - me.x, f = dx >= 0 ? 1 : -1, ad = Math.abs(dx), ady = Math.abs(opp.y - me.y);
    const s = me.shoulder;
    const arena = game.arena, main = arena.main, cx = (main.x1 + main.x2) / 2;
    const W = a => mirrorAngle(a, f);

    // Спасение при падении с платформы
    const overPlat = arena.isOverPlatform(me.x);
    if (!me.onGround && ((!overPlat && me.vy > -100) || me.y > main.y + 4)) {
      out.move = sign(cx - me.x) || 1;
      if (me.vy > 120 && me.airJumps > 0 && chance(p.recovery * 0.08)) out.jump = true;
      else if (me.airJumps === 0 && me.focus >= CFG.DASH_COST && me.vy > 200 && chance(p.recovery * 0.05)) out.dash = true;
      out.aim = W(-0.6);
      return out;
    }

    // Угроза: чужой клинок быстро летит в нашу сторону
    const oppTipSpeed = opp.alive ? opp.rotSpeedAt(ob.tip) : 0;
    const tipD = Math.hypot(this.perc.tx - me.x, this.perc.ty - (me.y - 55));
    const threat = opp.alive && tipD < 185 && oppTipSpeed > 450;
    if (threat && !this.threatSeen) {
      this.threatSeen = true;
      this.blockRoll = chance(p.block);
      const roomBehind = f > 0 ? me.x - main.x1 > 170 : main.x2 - me.x > 170;
      if (!this.blockRoll && chance(p.dodge) && me.dashCd <= 0 && me.focus > CFG.DASH_COST + 10 && roomBehind) {
        out.dash = true; out.move = -f;
      }
      const canSwitch = this.mode === 'neutral' || this.mode === 'recover' || (this.mode === 'windup' && chance(0.6));
      if (this.blockRoll && canSwitch) this.setMode('guard', rand(0.22, 0.34));
    }
    if (!threat && oppTipSpeed < 250) this.threatSeen = false;

    let move = 0;
    switch (this.mode) {
      case 'guard': {
        // Ставим клинок на линию к чужому острию — он обязан пересечь наш
        out.aim = Math.atan2(this.perc.ty - s.y, this.perc.tx - s.x);
        move = -f * 0.25;
        if (this.modeT <= 0) {
          if (opp.stagger > 0.15 && ad < 230) this.startSwing(0.06); // контратака после парирования
          else this.setMode('recover', rand(0.05, 0.15));
        }
        break;
      }
      case 'windup': {
        out.aim = W(this.swing.wind);
        move = f * 0.55;
        if (this.modeT <= 0) this.setMode('strike', 0.45);
        break;
      }
      case 'strike': {
        // Ведём клинок в заданном направлении, пока не пройдём сквозь линию на соперника
        const toOpp = Math.atan2((opp.y - 50) - s.y, opp.x - s.x);
        const target = W(mirrorAngle(toOpp, f) + this.swing.over);
        const dirW = this.swing.dir * f;
        const rem = (((dirW * (target - me.angle)) % TAU) + TAU) % TAU;
        out.aim = me.angle + dirW * Math.min(rem, 1.3);
        out.power = this.usePower;
        move = f * 0.7;
        if (rem < 0.15 || rem > TAU - 0.6 || this.modeT <= 0) {
          this.setMode('recover', rand(0.15, 0.32));
          this.cd = rand(0.3, 1.1) / p.aggression;
        }
        break;
      }
      case 'recover': {
        out.aim = W(-0.55);
        move = -f * 0.35;
        if (this.modeT <= 0) this.setMode('neutral');
        break;
      }
      default: {
        out.aim = W(-0.55 + Math.sin(this.t * 2.1) * 0.22);
        const want = p.spacing;
        if (ad > want + 45) move = f;
        else if (ad < want - 45) move = -f * 0.8;
        else {
          if (this.wanderT <= 0) { this.wander = rand(-0.6, 0.6); this.wanderT = rand(0.3, 0.8); }
          move = this.wander;
        }
        // Вертикаль: залезть к сопернику на уступ или спрыгнуть к нему
        if (opp.onGround && opp.y < me.y - 80 && ad < 260 && me.onGround && this.jumpCd <= 0) {
          out.jump = true; move = f; this.jumpCd = 0.8;
        }
        if (me.ground && !me.ground.main && opp.y > me.y + 80 && chance(dt * 1.5)) out.down = true;

        const inRange = ad < want + 55 && ady < 110 && opp.alive;
        if (inRange && opp.stagger > 0.2) this.startSwing(rand(0.04, 0.1));
        else if (inRange && this.cd <= 0 && chance(p.aggression * dt * 5)) this.startSwing(rand(p.windup[0], p.windup[1]));

        // Импульс: особенно охотно, когда соперник у края
        if (me.pushCd <= 0 && me.focus >= CFG.PUSH_COST + 5 && ad < 240 && ady < 120 && opp.alive) {
          const edge = f > 0 ? main.x2 - opp.x : opp.x - main.x1;
          if (edge < 280 && chance(p.push * dt * 4)) out.push = true;
          else if (ad < 100 && chance(p.push * dt * 0.8)) out.push = true;
        }
        if (me.onGround && this.jumpCd <= 0 && chance(dt * 0.15 * p.aggression)) { out.jump = true; this.jumpCd = 1.5; }
      }
    }

    // Не уходить с края главной платформы; если зажали в угол — перепрыгнуть
    if (me.ground === main) {
      if (me.x < main.x1 + 70 && move < 0) move = 0.6;
      if (me.x > main.x2 - 70 && move > 0) move = -0.6;
      const cornered = (me.x < main.x1 + 150 && f > 0) || (me.x > main.x2 - 150 && f < 0);
      if (cornered && ad < 170 && this.jumpCd <= 0 && chance(dt * 2.5 * p.recovery)) {
        out.jump = true; move = f; this.jumpCd = 1.0;
      }
    }
    out.move = clamp(move, -1, 1);
    return out;
  }
}
