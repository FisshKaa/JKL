'use strict';
// Бот отдаёт тот же input, что и игрок. Он видит замах соперника с задержкой реакции
// и может ошибиться со стороной блока: это и есть уровень сложности.
const BOT_LEVELS = {
  easy:   { title: 'Ученик', reaction: 0.36, block: 0.45, read: 0.6,  perfect: 0.05, aggression: 0.35, combo: 0.2,  feint: 0,    exploit: 0.3,  mash: 4.5, dodge: 0.1,  clash: 0,    clinch: 0.05, windupMul: 1.25 },
  normal: { title: 'Рыцарь', reaction: 0.24, block: 0.7,  read: 0.82, perfect: 0.2,  aggression: 0.55, combo: 0.45, feint: 0.12, exploit: 0.6,  mash: 6.5, dodge: 0.15, clash: 0.15, clinch: 0.15, windupMul: 1.0 },
  hard:   { title: 'Мастер', reaction: 0.15, block: 0.88, read: 0.95, perfect: 0.35, aggression: 0.75, combo: 0.65, feint: 0.3,  exploit: 0.85, mash: 8.5, dodge: 0.2,  clash: 0.3,  clinch: 0.25, windupMul: 0.88 },
};

class BotController {
  constructor(level = 'normal') {
    this.level = level;
    this.p = BOT_LEVELS[level];
    this.roundId = -1;
    this.reset();
  }

  reset() {
    this.plan = null; this.seenAttack = -1;
    this.cd = rand(0.6, 1.2); this.comboLeft = 0; this.feintThis = false;
    this.strafe = 0; this.strafeT = 0; this.stanceT = 0; this.holdStance = randInt(4);
    this.mashT = 0;
  }

  pickDir(me, opp) {
    const dirs = [0, 1, 2, 3];
    let pool = dirs;
    if (chance(this.p.exploit)) {
      const guarded = mirrorDir(opp.stance); // этот удар уйдёт прямо в его стойку
      pool = dirs.filter(d => d !== guarded && d !== me.lastDir);
    }
    return pool[randInt(pool.length)];
  }

  getInput(me, opp, game, dt) {
    const p = this.p;
    me.windupMul = p.windupMul;
    const out = { mx: 0, mz: 0, stance: null, attack: false, block: false, feint: false, dodge: false, clinch: false, mash: false, lock: true };
    if (this.roundId !== game.roundId) { this.reset(); this.roundId = game.roundId; }
    if (!game.controlsEnabled || me.dead) return out;

    this.cd -= dt; this.strafeT -= dt; this.stanceT -= dt; this.mashT -= dt;
    const d = dist2d(me, opp);

    // Клинч: давим с частотой по уровню
    if (me.state === 'bind') {
      if (this.mashT <= 0) { out.mash = true; this.mashT = (1 / p.mash) * rand(0.6, 1.4); }
      const bd = game.bind;
      const losing = bd && (bd.a === me ? bd.m < -0.6 : bd.m > 0.6);
      if (losing && me.stam > 30 && chance(dt * 0.8)) out.dodge = true;
      return out;
    }

    // Защита: заметили новый замах
    if (opp.state === 'windup' && opp.attack.id !== this.seenAttack) {
      this.seenAttack = opp.attack.id;
      this.plan = { id: opp.attack.id, decideAt: game.time + p.reaction * rand(0.8, 1.2), decided: false, action: 'none' };
    }
    let plan = this.plan;
    if (plan && (opp.state !== 'windup' || opp.attack.id !== plan.id)) {
      if (plan.endAt === undefined) plan.endAt = game.time + 0.15;
      if (game.time > plan.endAt) this.plan = plan = null;
    }
    if (plan && !plan.decided && game.time >= plan.decideAt && opp.state === 'windup' && opp.attack.id === plan.id) {
      plan.decided = true;
      const need = mirrorDir(opp.attack.dir);
      const tti = opp.timeToImpact(), impactAt = game.time + tti;
      const myWindup = CFG.WINDUP * p.windupMul;
      if (me.state === 'windup' && me.timeToImpact() < tti - 0.05) plan.action = 'trade';
      else if (me.state === 'idle' && chance(p.clash) && tti > myWindup) {
        plan.action = 'clash'; plan.side = need; plan.attackAt = impactAt - myWindup + rand(-0.03, 0.03);
      } else if (chance(p.block)) {
        plan.action = 'block';
        plan.side = chance(p.read) ? need : [0, 1, 2, 3].filter(x => x !== need)[randInt(3)];
        plan.blockAt = chance(p.perfect) ? impactAt - rand(0.04, 0.15) : game.time;
      } else if (chance(p.dodge) && me.stam > CFG.DODGE_COST + 5) plan.action = 'dodge';
    }

    const defending = plan && plan.decided && plan.action !== 'none' && plan.action !== 'trade';
    if (defending) {
      if (plan.action === 'block') {
        out.stance = plan.side;
        if (me.state === 'windup') out.feint = true;  // бросаем свой удар ради защиты
        if (game.time >= plan.blockAt) out.block = true;
      } else if (plan.action === 'dodge') {
        out.dodge = true; out.mz = -1; out.mx = chance(0.5) ? 1 : -1;
        plan.action = 'none';
      } else if (plan.action === 'clash') {
        out.stance = plan.side;
        if (game.time >= plan.attackAt && me.state === 'idle') { out.attack = true; plan.action = 'none'; }
      }
    } else {
      // Атака
      const canChain = me.state === 'recover' && me.stateT > CFG.COMBO_OPEN;
      if (me.state === 'idle' || canChain) {
        const punish = opp.state === 'stagger' || (opp.state === 'recover' && opp.recoverDur >= CFG.RECOVER_BLOCKED);
        let want = false;
        if (canChain) want = this.comboLeft > 0;
        else if (d < 2.5 && (me.riposteT > 0 || (punish && chance(0.6)) || (this.cd <= 0 && chance(p.aggression * dt * 2.5)))) want = true;
        if (want && me.stam > CFG.ATTACK_COST + 4) {
          const dir = this.pickDir(me, opp);
          out.stance = dir; out.attack = true;
          if (canChain) this.comboLeft--;
          else this.comboLeft = chance(p.combo) ? (chance(p.combo) ? 2 : 1) : 0;
          this.cd = rand(0.5, 1.4) / p.aggression;
          this.feintThis = me.riposteT <= 0 && chance(p.feint);
        }
      }
      if (me.state === 'windup' && this.feintThis && me.stateT > me.dur * 0.45) {
        out.feint = true; this.feintThis = false; this.cd = 0.1;
      }
      if (me.state === 'idle' && d < CFG.CLINCH_DIST - 0.15 && (opp.blocking || opp.state === 'recover') && chance(p.clinch * dt * 2)) out.clinch = true;
    }

    // Стойка в покое: бот меняет позы, чтобы его было сложнее читать
    if (out.stance === null) {
      if (this.stanceT <= 0) { this.holdStance = randInt(4); this.stanceT = rand(0.7, 2.0); }
      out.stance = this.holdStance;
    }

    // Дистанция и обход по кругу
    const want = 1.95;
    if (d > want + 0.45) out.mz = 1;
    else if (d < want - 0.55) out.mz = -0.8;
    if (this.strafeT <= 0) { this.strafe = chance(0.35) ? 0 : (chance(0.5) ? 1 : -1) * rand(0.4, 0.9); this.strafeT = rand(0.6, 1.6); }
    if (!out.dodge) out.mx = this.strafe;

    // Не упираться в край арены
    const r = Math.hypot(me.x, me.z);
    if (r > CFG.ARENA_R - 1.6) {
      const f = fwdOf(me.yaw), rt = rightOf(me.yaw);
      const cx = -me.x / r, cz = -me.z / r;
      out.mz = clamp(out.mz + (cx * f.x + cz * f.z), -1, 1);
      out.mx = clamp(out.mx + (cx * rt.x + cz * rt.z), -1, 1);
    }
    return out;
  }
}
