'use strict';
// Бот отдаёт тот же input, что и игрок. Он видит замах соперника с задержкой реакции
// и может ошибиться со стороной блока: это и есть уровень сложности.
const BOT_LEVELS = {
  easy:   { learn: 0, push: 0.2, heavy: 0.1, thrust: 0.06, title: 'Ученик', reaction: 0.36, block: 0.45, read: 0.6,  perfect: 0.05, aggression: 0.35, combo: 0.2,  feint: 0,    exploit: 0.3,  dodge: 0.1,  flip: 0.1, clash: 0,    clinch: 0.05, windupMul: 1.25, bindTry: 0.7,  bindSigma: 0.04,  bindWrong: 0.4 },
  normal: { learn: 0.5, push: 0.5, heavy: 0.25, thrust: 0.12, title: 'Рыцарь', reaction: 0.24, block: 0.7,  read: 0.82, perfect: 0.2,  aggression: 0.55, combo: 0.45, feint: 0.12, exploit: 0.6,  dodge: 0.15, flip: 0.3, clash: 0.15, clinch: 0.15, windupMul: 1.0,  bindTry: 0.9,  bindSigma: 0.022, bindWrong: 0.2 },
  hard:   { learn: 0.9, push: 0.8, heavy: 0.35, thrust: 0.16, title: 'Мастер', reaction: 0.15, block: 0.88, read: 0.95, perfect: 0.35, aggression: 0.75, combo: 0.65, feint: 0.3,  exploit: 0.85, dodge: 0.2,  flip: 0.5, clash: 0.3,  clinch: 0.25, windupMul: 0.88, bindTry: 0.97, bindSigma: 0.013, bindWrong: 0.05 },
};

class BotController {
  constructor(level = 'normal') {
    this.level = level;
    this.p = BOT_LEVELS[level];
    this.roundId = -1;
    // Привычки соперника: живут весь матч и постепенно забываются
    this.habits = { atk: [0, 0, 0, 0, 0, 0], guard: [0, 0, 0, 0, 0] };
    this.reset();
  }

  // Параметры уровня с поправкой на форму боя бота
  styled(me) {
    if (this._styleKey !== me.style) {
      this._styleKey = me.style;
      const m = styleOf(me).bot || {}, P = Object.assign({}, this.p);
      for (const k in m) P[k] = typeof P[k] === 'number' ? P[k] * m[k] : m[k];
      P.block = Math.min(0.97, P.block); P.perfect = Math.min(0.9, P.perfect);
      this._pe = P;
    }
    return this._pe;
  }

  favAttack() {
    const a = this.habits.atk, sum = a.reduce((x, y) => x + y, 0);
    if (sum < 3) return -1;
    let best = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
    return a[best] / sum > 0.3 ? best : -1;
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
    const G = this.habits.guard, gsum = G.reduce((x, y) => x + y, 0);
    if (gsum > 4 && chance(this.p.learn * 0.6)) {
      // Бьём туда, где соперник обычно открыт: удар в сторону d попадает в его стойку mirrorDir(d)
      const w = pool.map(d => 1 / (0.15 + G[mirrorDir(d)] / gsum));
      let r = Math.random() * w.reduce((x, y) => x + y, 0);
      for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    }
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
    const p = this.styled(me);
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

    // Без клинка: подобрать, если близко, иначе притянуть силой
    if (me.disarm) {
      const D = me.disarm, ddx = D.x - me.x, ddz = D.z - me.z, dd = Math.hypot(ddx, ddz) || 1;
      if (D.landed && dd < 5 && Math.abs(D.y - me.y) < 1) {
        const f = fwdOf(me.yaw), rt = rightOf(me.yaw);
        out.mz = clamp((ddx * f.x + ddz * f.z) / dd * 1.5, -1, 1);
        out.mx = clamp((ddx * rt.x + ddz * rt.z) / dd * 1.5, -1, 1);
      } else if (me.state === 'idle' && D.landed) out.push = true;
      if (!ARENA.walls && me.onGround) this.avoidEdges(me, out);
      return out;
    }

    // Толчок или пинок соперника: успеть увернуться в сторону (с задержкой реакции)
    if ((opp.state === 'push' && !opp.pushFired) || (opp.state === 'kick' && !opp.kickFired)) {
      if (!this.pushSeen && opp.stateT >= p.reaction * 0.6) {
        this.pushSeen = true;
        if (d < (opp.state === 'kick' ? CFG.KICK_RANGE + 0.4 : CFG.PUSH_RANGE + 0.5) && me.onGround && me.stam > CFG.DODGE_COST && chance(p.dodge * 2.5)) {
          out.dodge = true; out.mz = 0; out.mx = chance(0.5) ? 1 : -1;
          if (!ARENA.walls) this.avoidEdges(me, out);
          return out;
        }
      }
    } else this.pushSeen = false;

    // Защита: заметили новый замах
    // Наблюдаем за привычками: где держит защиту, откуда бьёт
    const fade = Math.exp(-dt / 25);
    for (let i = 0; i < 5; i++) this.habits.guard[i] *= fade;
    if (opp.stance < 5) this.habits.guard[opp.stance] += dt * (opp.blocking ? 2 : 1);

    if (opp.state === 'windup' && opp.attack.id !== this.seenAttack) {
      this.seenAttack = opp.attack.id;
      const A = this.habits.atk;
      for (let i = 0; i < A.length; i++) A[i] *= 0.92;
      A[opp.attack.dir] += 1;
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
      else if (me.state === 'idle' && me.onGround && need !== DIR.THRUST && chance(p.clash) && tti > myWindup) {
        plan.action = 'clash'; plan.side = need; plan.attackAt = impactAt - myWindup + rand(-0.03, 0.03);
      } else if (chance(p.block)) {
        plan.action = 'block';
        // Укол принимается любой стойкой
        const fav = this.favAttack();
        const guess = fav >= 0 && fav !== DIR.THRUST && chance(p.learn) ? mirrorDir(fav) : [0, 1, 2, 3, 4].filter(x => x !== need)[randInt(4)];
        plan.side = need === DIR.THRUST ? me.stance : chance(p.read) ? need : guess;
        // Уже стоим в нужной стойке (угадали привычку) — проще поймать мастерским блоком
        const ready = me.stance === plan.side && plan.side === need;
        plan.blockAt = chance(p.perfect + (ready ? p.learn * 0.35 : 0)) ? impactAt - rand(0.04, 0.15) : game.time;
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
          if (chance(p.thrust)) out.thrust = true;
          else { out.stance = this.pickDir(me, opp); out.attack = true; }
          this.heavyThis = !out.thrust && me.riposteT <= 0 && chance(p.heavy);
          if (canChain) this.comboLeft--;
          else this.comboLeft = chance(p.combo) ? (chance(p.combo) ? 2 : 1) : 0;
          this.cd = rand(0.5, 1.4) / p.aggression;
          this.feintThis = me.riposteT <= 0 && chance(p.feint);
        }
      }
      if (me.state === 'windup' && this.heavyThis) out.attackHeld = true;
      if (me.state === 'windup' && this.feintThis && !this.heavyThis && me.stateT > me.dur * 0.45) {
        out.feint = true; this.feintThis = false; this.cd = 0.1;
      }
      if (me.state === 'idle' && d < CFG.CLINCH_DIST - 0.15 && (opp.blocking || opp.state === 'recover') && chance(p.clinch * dt * 2)) out.clinch = true;
      // Толчок: охотно — если за спиной соперника пропасть, изредка — против глухой защиты
      if (me.state === 'idle' && me.pushCd <= 0 && me.stam > CFG.PUSH_COST + 10 && d < CFG.PUSH_RANGE - 0.3) {
        const ux = (opp.x - me.x) / (d || 1), uz = (opp.z - me.z) / (d || 1);
        const edge = !ARENA.walls && ARENA.groundAt(opp.x + ux * 1.8, opp.z + uz * 1.8, opp.y + 0.3).y < opp.y - 1.3;
        if (edge && chance(p.push * dt * 2.5)) out.push = true;
        else if (opp.blocking && chance(p.push * dt * 0.5)) out.push = true;
      }
      // Пинок против глухой защиты
      if (me.state === 'idle' && !out.push && me.kickCd <= 0 && me.onGround && me.stam > CFG.KICK_COST + 10 && d < CFG.KICK_RANGE - 0.1 && chance(p.push * dt * (opp.blocking ? 1.6 : 0.25))) out.kick = true;
      // На дистанции бот иногда красуется — крутит клинок
      if (me.state === 'idle' && d > 3.2 && !me.blocking && chance(dt * 0.12)) out.flourish = true;
      // Акробаты (Атару, Джуйо) сами крутят сальто вбок и назад по ходу боя
      if (p.acro && me.state === 'idle' && me.onGround && this.jumpCd <= 0 && me.stam > 45 && !this.script.length && chance(p.acro * dt * 0.35)) {
        const side = chance(0.5) ? 1 : -1, back = chance(0.35);
        this.scriptT = 0;
        this.script = [{ at: 0, press: { jump: true, jumpHeld: true } }, { at: 0.2, hold: { jumpHeld: true }, press: { jump: true, mx: back ? 0 : side, mz: back ? -1 : 0 } }];
        this.jumpCd = 2.2;
      }
      // Иногда — удар в прыжке с дистанции
      if (me.state === 'idle' && me.onGround && d > 2.2 && d < 3.3 && this.jumpCd <= 0 && me.stam > 40 && chance(p.aggression * dt * 0.25)) {
        this.scriptT = 0;
        this.script = [{ at: 0, press: { jump: true, jumpHeld: true }, hold: { mz: 1 } }, { at: 0.3, hold: { mz: 1 }, press: { attack: true } }];
        this.jumpCd = 2.5;
      }
    }

    if (out.stance === null) {
      if (this.stanceT <= 0) {
        const fav = this.favAttack();
        // Заранее закрываемся от любимого удара соперника
        this.holdStance = fav >= 0 && fav !== DIR.THRUST && chance(p.learn * 0.7) ? mirrorDir(fav) : randInt(NDIR);
        this.stanceT = rand(0.7, 2.0);
      }
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

    // Не упираться в край арены с невидимой стеной
    const r = Math.hypot(me.x, me.z);
    if (ARENA.walls && r > ARENA.radius - 1.6) {
      const f = fwdOf(me.yaw), rt = rightOf(me.yaw);
      const cx = -me.x / r, cz = -me.z / r;
      out.mz = clamp(out.mz + (cx * f.x + cz * f.z), -1, 1);
      out.mx = clamp(out.mx + (cx * rt.x + cz * rt.z), -1, 1);
    }
    this.runScript(out, dt);
    if (!ARENA.walls && me.onGround) this.avoidEdges(me, out);
    return out;
  }

  // Арена с пропастью: не шагать туда, где нет опоры, и отходить от края
  avoidEdges(me, out) {
    const f = fwdOf(me.yaw), r = rightOf(me.yaw);
    const safe = (mx, mz, d) => {
      const dx = f.x * mz + r.x * mx, dz = f.z * mz + r.z * mx, l = Math.hypot(dx, dz) || 1;
      return ARENA.groundAt(me.x + dx / l * d, me.z + dz / l * d, me.y + 0.3).y > me.y - 1.3;
    };
    for (const [mx, mz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (!safe(mx, mz, 0.75)) { out.mx = clamp((out.mx || 0) - mx * 0.9, -1, 1); out.mz = clamp((out.mz || 0) - mz * 0.9, -1, 1); }
    }
    if (out.mz && !safe(0, sign(out.mz), 0.9)) out.mz = 0;
    if (out.mx && !safe(sign(out.mx), 0, 0.9)) out.mx = 0;
    if (out.dodge && !safe(out.mx || 0, out.mz || -1, 2.3)) {
      if (safe(0, -1, 2.3)) { out.mx = 0; out.mz = -1; } else out.dodge = false;
    }
  }
}
