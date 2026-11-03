'use strict';
// Бот отдаёт тот же input, что и игрок. Он видит замах соперника с задержкой реакции
// и может ошибиться со стороной блока: это и есть уровень сложности.
const BOT_LEVELS = {
  easy:   { title: 'Ученик', reaction: 0.36, block: 0.45, read: 0.6,  perfect: 0.05, aggression: 0.35, combo: 0.2,  feint: 0,    exploit: 0.3,  dodge: 0.1,  flip: 0.1, clash: 0,    clinch: 0.05, windupMul: 1.25, bindTry: 0.7,  bindSigma: 0.04,  bindWrong: 0.4 },
  normal: { title: 'Рыцарь', reaction: 0.24, block: 0.7,  read: 0.82, perfect: 0.2,  aggression: 0.55, combo: 0.45, feint: 0.12, exploit: 0.6,  dodge: 0.15, flip: 0.3, clash: 0.15, clinch: 0.15, windupMul: 1.0,  bindTry: 0.9,  bindSigma: 0.022, bindWrong: 0.2 },
  hard:   { title: 'Мастер', reaction: 0.15, block: 0.88, read: 0.95, perfect: 0.35, aggression: 0.75, combo: 0.65, feint: 0.3,  exploit: 0.85, dodge: 0.2,  flip: 0.5, clash: 0.3,  clinch: 0.25, windupMul: 0.88, bindTry: 0.97, bindSigma: 0.013, bindWrong: 0.05 },
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
    this.strafe = 0; this.strafeT = 0; this.stanceT = 0; this.holdStance = randInt(NDIR);
    this.bindId = -1; this.bindPresses = [];
    this.script = []; this.scriptT = 0; this.jumpCd = 0; this.stuckT = 0;
  }

  pickDir(me, opp) {
    let pool = [0, 1, 2, 3, 4];
    if (chance(this.p.exploit)) {
      const guarded = mirrorDir(opp.stance); // этот удар уйдёт прямо в его защиту
      pool = pool.filter(d => d !== guarded && d !== me.lastDir);
    }
    return pool[randInt(pool.length)];
  }

  // Короткие сценарии движения: прыжок, затем сальто
  runScript(out, dt) {
    if (!this.script.length) return false;
    this.scriptT += dt;
    const s = this.script[0];
    Object.assign(out, s.hold || {});
    if (this.scriptT >= s.at) {
      Object.assign(out, s.press || {});
      this.script.shift();
    }
    return true;
  }

  getInput(me, opp, game, dt) {
    const p = this.p;
    me.windupMul = p.windupMul;
    const out = { mx: 0, mz: 0, stance: null, attack: false, block: false, feint: false, dodge: false, jump: false, jumpHeld: false, clinch: false, mash: false, lock: true };
    if (this.roundId !== game.roundId) { this.reset(); this.roundId = game.roundId; }
    if (!game.controlsEnabled || me.dead) return out;

    this.cd -= dt; this.strafeT -= dt; this.stanceT -= dt; this.jumpCd -= dt;
    const d = dist2d(me, opp), dy = opp.y - me.y;

    // Клинч: заранее «планируем» нажатия у центров зон с ошибкой по уровню
    if (me.state === 'bind' && game.bind) {
      const bd = game.bind, s = game.bindSide(me);
      if (bd.id !== this.bindId) {
        this.bindId = bd.id;
        this.bindPresses = bd.zones.filter(() => chance(p.bindTry)).map(z => (z.c + gauss() * p.bindSigma) * s.rev);
        if (chance(p.bindWrong)) this.bindPresses.push(rand(0.1, 0.95) * s.rev);
        this.bindPresses.sort((x, y) => x - y);
      }
      if (this.bindPresses.length && bd.t >= this.bindPresses[0]) { out.mash = true; this.bindPresses.shift(); }
      return out;
    }

    // Вис на уступе: подтягиваемся, если соперник наверху, иначе спрыгиваем
    if (me.state === 'hang') { if (dy > -0.5) out.mz = 1; else out.mz = -1; return out; }

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
      else if (me.state === 'idle' && me.onGround && chance(p.clash) && tti > myWindup) {
        plan.action = 'clash'; plan.side = need; plan.attackAt = impactAt - myWindup + rand(-0.03, 0.03);
      } else if (chance(p.block)) {
        plan.action = 'block';
        plan.side = chance(p.read) ? need : [0, 1, 2, 3, 4].filter(x => x !== need)[randInt(4)];
        plan.blockAt = chance(p.perfect) ? impactAt - rand(0.04, 0.15) : game.time;
      } else if (chance(p.dodge) && me.stam > CFG.DODGE_COST + 5) {
        plan.action = me.onGround && chance(p.flip) && me.stam > CFG.FLIP_COST + 10 ? 'flip' : 'dodge';
      }
    }

    const defending = plan && plan.decided && plan.action !== 'none' && plan.action !== 'trade';
    if (defending) {
      if (plan.action === 'block') {
        out.stance = plan.side;
        if (me.state === 'windup') out.feint = true;
        if (game.time >= plan.blockAt) out.block = true;
      } else if (plan.action === 'dodge') {
        out.dodge = true; out.mz = -1; out.mx = chance(0.5) ? 1 : -1;
        plan.action = 'none';
      } else if (plan.action === 'flip') {
        // Прыжок и сальто назад или вбок
        const side = chance(0.5) ? 0 : (chance(0.5) ? 1 : -1);
        this.scriptT = 0;
        this.script = [
          { at: 0, press: { jump: true, jumpHeld: true } },
          { at: 0.18, hold: { jumpHeld: true }, press: { jump: true, mz: side ? 0 : -1, mx: side } },
        ];
        plan.action = 'none';
      } else if (plan.action === 'clash') {
        out.stance = plan.side;
        if (game.time >= plan.attackAt && me.state === 'idle') { out.attack = true; plan.action = 'none'; }
      }
    } else if (Math.abs(dy) < 1.0) {
      const canChain = me.state === 'recover' && me.stateT > CFG.COMBO_OPEN;
      if (me.state === 'idle' || canChain) {
        const punish = opp.state === 'stagger' || opp.state === 'hang' || opp.state === 'climb' || opp.state === 'vault' || (opp.state === 'recover' && opp.recoverDur >= CFG.RECOVER_BLOCKED);
        let want = false;
        if (canChain) want = this.comboLeft > 0;
        else if (d < 2.5 && (me.riposteT > 0 || (punish && chance(0.6)) || (this.cd <= 0 && chance(p.aggression * dt * 2.5)))) want = true;
        if (want && me.stam > CFG.ATTACK_COST + 4 && !me.flip) {
          out.stance = this.pickDir(me, opp); out.attack = true;
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

    if (out.stance === null) {
      if (this.stanceT <= 0) { this.holdStance = randInt(NDIR); this.stanceT = rand(0.7, 2.0); }
      out.stance = this.holdStance;
    }

    // Дистанция и обход по кругу
    const want = 1.95;
    if (d > want + 0.45) out.mz = 1;
    else if (d < want - 0.55) out.mz = -0.8;
    if (this.strafeT <= 0) { this.strafe = chance(0.35) ? 0 : (chance(0.5) ? 1 : -1) * rand(0.4, 0.9); this.strafeT = rand(0.6, 1.6); }
    if (!out.dodge) out.mx = this.strafe;

    // Высота: соперник забрался выше — прыгаем к нему (подтягивание сработает само)
    if (me.onGround && me.state === 'idle' && this.jumpCd <= 0) {
      if (dy > 0.45 && d < 3.5) {
        this.scriptT = 0;
        this.script = [{ at: 0, press: { jump: true, jumpHeld: true }, hold: { mz: 1 } }, { at: dy > 1.2 ? 0.45 : 0.15, hold: { jumpHeld: true, mz: 1 } }];
        this.jumpCd = 1.2;
      }
    }
    // Упёрлись в препятствие — перепрыгнуть
    if (me.onGround && out.mz > 0 && me.wallT < 0.1 && me.speed < 1) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 0.3 && this.jumpCd <= 0) {
      this.scriptT = 0;
      this.script = [{ at: 0, press: { jump: true, jumpHeld: true }, hold: { mz: 1 } }, { at: 0.4, hold: { jumpHeld: true, mz: 1 } }];
      this.jumpCd = 1.0; this.stuckT = 0;
    }
    // В воздухе тянемся к уступу, если он между нами и соперником
    if (!me.onGround && dy > 0.3) out.mz = 1;

    // Не упираться в край арены
    const r = Math.hypot(me.x, me.z);
    if (r > CFG.ARENA_R - 1.6) {
      const f = fwdOf(me.yaw), rt = rightOf(me.yaw);
      const cx = -me.x / r, cz = -me.z / r;
      out.mz = clamp(out.mz + (cx * f.x + cz * f.z), -1, 1);
      out.mx = clamp(out.mx + (cx * rt.x + cz * rt.z), -1, 1);
    }

    this.runScript(out, dt);
    return out;
  }
}
