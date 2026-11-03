'use strict';
// Ядро боя. Не знает про three.js: эффекты и звук приходят снаружи через fx и audio.
class Game {
  constructor(fx = NOOP, audio = NOOP) {
    this.fx = fx;
    this.audio = audio;
    this.fighters = [new Fighter(0, 'Ты', CFG.BLADE_COLORS[0]), new Fighter(1, 'Бот', '#ff4058')];
    this.controllers = [null, null];
    this.mode = 'none';
    this.state = 'idle';
    this.scores = [0, 0];
    this.round = 1; this.roundId = 0;
    this.time = 0; this.stateT = 0;
    this.hitstop = 0; this.slowT = 0; this.timeScale = 1;
    this.bind = null;
    this.shakeAmt = 0; this.hurt = 0;
    this.popups = [];
    this.announcement = null;
    this.paused = false;
    this.onMatchEnd = null;
    this.acc = 0;
    this.lastInputs = [{}, {}];
  }

  get controlsEnabled() { return this.state === 'fight'; }

  startMatch(mode, controllers) {
    this.mode = mode;
    this.controllers = controllers;
    this.scores = [0, 0];
    this.round = 1;
    this.paused = false;
    this.startRound();
  }

  startRound() {
    this.roundId++;
    const [a, b] = this.fighters;
    a.reset(0, 3, 0);
    b.reset(0, -3, Math.PI);
    this.state = 'intro'; this.stateT = 0;
    this.bind = null; this.hitstop = 0; this.slowT = 0; this.timeScale = 1;
    this.popups = []; this.ignited = false; this.hurt = 0;
    this.announce(`Раунд ${this.round}`, 1.4, this.round > 1 ? `${this.scores[0]} : ${this.scores[1]}` : '');
  }

  announce(text, dur = 1.2, sub = '', color = '#ffffff') { this.announcement = { text, sub, t: 0, dur, color }; }

  // Всплывающая надпись. who — чья это заслуга/проблема (для цвета и фильтра в режиме демо)
  pop(text, color = '#ffffff') { this.popups.push({ text, color, t: 0, dur: 1.1 }); }

  shake(v) { this.shakeAmt = Math.min(1, this.shakeAmt + v); }

  // Реальное время кадра → фиксированные шаги симуляции
  advance(realDt) {
    if (this.paused || this.state === 'idle') return;
    if (this.hitstop > 0) { this.hitstop -= realDt; }
    else {
      if (this.slowT > 0) { this.slowT -= realDt; this.timeScale = 0.3; }
      else this.timeScale = Math.min(1, this.timeScale + realDt * 2);
      this.acc += realDt * this.timeScale;
      let n = 0;
      while (this.acc >= CFG.DT && n < 8) { this.step(CFG.DT); this.acc -= CFG.DT; n++; }
      if (n >= 8) this.acc = 0;
    }
    if (this.announcement) {
      this.announcement.t += realDt;
      if (this.announcement.t > this.announcement.dur) this.announcement = null;
    }
    for (const p of this.popups) p.t += realDt;
    this.popups = this.popups.filter(p => p.t < p.dur);
    this.shakeAmt = Math.max(0, this.shakeAmt - realDt * 2.5);
    this.hurt = Math.max(0, this.hurt - realDt * 1.8);
  }

  step(dt) {
    this.time += dt; this.stateT += dt;
    const [A, B] = this.fighters;
    const inA = this.input(0, dt), inB = this.input(1, dt);
    this.lastInputs = [inA, inB];
    A.update(dt, inA, B, this);
    B.update(dt, inB, A, this);
    if (this.bind) this.updateBind(dt, inA, inB);
    this.separate(A, B);
    this.updateState(dt);
  }

  input(i, dt) {
    const c = this.controllers[i];
    return c ? c.getInput(this.fighters[i], this.fighters[1 - i], this, dt) : {};
  }

  updateState(dt) {
    if (this.state === 'intro') {
      if (!this.ignited && this.stateT > 0.4) { this.ignited = true; this.audio.ignite(); }
      if (this.ignited) for (const f of this.fighters) f.ignite = Math.min(1, f.ignite + dt * 3);
      if (this.stateT > 1.5) { this.state = 'fight'; this.stateT = 0; this.announce('Бой!', 0.7); }
    } else if (this.state === 'roundEnd') {
      for (const f of this.fighters) if (f.dead) f.ignite = Math.max(0, f.ignite - dt * 2.5);
      if (this.stateT > 2.6) {
        const w = this.scores.findIndex(s => s >= CFG.ROUNDS_TO_WIN);
        if (w >= 0) { this.state = 'matchEnd'; this.stateT = 0; if (this.onMatchEnd) this.onMatchEnd(w); }
        else { this.round++; this.startRound(); }
      }
    }
  }

  separate(A, B) {
    if (A.dead || B.dead || this.bind) return;
    const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.001;
    if (d < CFG.MIN_DIST) {
      const p = (CFG.MIN_DIST - d) / 2;
      A.x -= dx / d * p; A.z -= dz / d * p;
      B.x += dx / d * p; B.z += dz / d * p;
    }
  }

  // Точка в мире, где клинок встречает защитника
  contactPoint(A, D, dir, k = 0.72) {
    const r = rightOf(A.yaw);
    const side = dir === DIR.RIGHT ? 0.32 : dir === DIR.LEFT ? -0.32 : 0;
    const h = dir === DIR.UP ? 1.55 : dir === DIR.DOWN ? 0.95 : 1.3;
    return { x: lerp(A.x, D.x, k) + r.x * side, y: h, z: lerp(A.z, D.z, k) + r.z * side };
  }

  resolveImpact(A, D) {
    const atk = A.attack;
    A.setState('strike', CFG.STRIKE);
    A.recoverDur = CFG.RECOVER;

    const d = dist2d(A, D);
    const f = fwdOf(A.yaw);
    const cosA = d > 0.001 ? ((D.x - A.x) * f.x + (D.z - A.z) * f.z) / d : 1;
    if (D.dead || d > CFG.REACH || cosA < Math.cos(CFG.ARC)) { A.recoverDur = CFG.RECOVER_WHIFF; return; }

    if (D.isInvulnerable()) {
      A.recoverDur = CFG.RECOVER_WHIFF;
      this.pop('Уклонение', '#cfe3ff');
      return;
    }

    const need = mirrorDir(atk.dir);

    // Встречные удары в одной линии — клинки сцепляются
    if (D.state === 'windup' && D.timeToImpact() < 0.13 && D.attack.dir === need) {
      this.startBind(A, D, this.contactPoint(A, D, atk.dir, 0.5));
      return;
    }

    if (D.blocking) {
      if (D.stance === need) {
        const p = this.contactPoint(A, D, atk.dir);
        atk.blocked = true;
        if (this.time - D.blockStart <= CFG.PERFECT) {
          // Мастерский блок: атакующий раскрыт, у защитника быстрый усиленный контрудар
          A.stagger(CFG.STAGGER_PERFECT);
          D.riposteT = CFG.RIPOSTE_WINDOW;
          D.stam = Math.min(CFG.STAM_MAX, D.stam + 10);
          this.pop('Мастерский блок', D.color);
          this.fx.clash(p, 1, A.color, D.color);
          this.audio.clash(1, true);
          this.hitstop = 0.11; this.shake(0.45);
          return;
        }
        D.spend(atk.riposte ? CFG.BLOCK_COST_RIPOSTE : CFG.BLOCK_COST);
        A.recoverDur = CFG.RECOVER_BLOCKED;
        this.fx.clash(p, 0.6, A.color, D.color);
        this.audio.clash(0.6);
        this.hitstop = 0.05; this.shake(0.22);
        if (D.stam <= 0) {
          D.stagger(CFG.STAGGER_BREAK);
          this.pop('Защита пробита', A.color);
          this.audio.guardBreak();
          this.hitstop = 0.1; this.shake(0.4);
          return;
        }
        if (d < 2.3 && chance(CFG.BIND_ON_BLOCK)) this.startBind(A, D, p);
        return;
      }
      this.pop('Не та сторона', '#ffb36b');
    }

    // Попадание
    let dmg = CFG.DMG * CFG.DIR_MUL[atk.dir];
    if (atk.riposte) dmg *= CFG.RIPOSTE_MUL;
    if (atk.combo >= 2) dmg *= CFG.COMBO_MUL;
    D.hp -= dmg;
    D.hitFlash = 0.2;
    D.stagger(CFG.STAGGER_HIT);
    D.vx += f.x * 2.6; D.vz += f.z * 2.6;
    const p = this.contactPoint(A, D, atk.dir, 0.86);
    this.fx.hit(p, A.color, dmg);
    this.audio.hit(clamp(dmg / 25, 0, 1));
    this.hitstop = 0.07 + dmg * 0.002;
    this.shake(D.index === 0 && this.mode === 'bot' ? 0.6 : 0.3);
    if (D.index === 0 && this.mode === 'bot') this.hurt = 1;
    if (atk.riposte) this.pop('Контрудар', A.color);
    if (D.hp <= 0) this.onKO(D, A);
  }

  onFeint(f) {
    if (f.index === 0 || this.mode === 'demo') this.pop('Финт', '#cfe3ff');
  }

  tryClinch(A, D) {
    if (dist2d(A, D) > CFG.CLINCH_DIST || A.stam < CFG.CLINCH_COST || D.dead) return;
    if (D.state === 'dodge' || D.state === 'stagger') return;
    A.spend(CFG.CLINCH_COST);
    const p = { x: (A.x + D.x) / 2, y: 1.35, z: (A.z + D.z) / 2 };
    this.startBind(A, D, p);
  }

  startBind(A, D, p) {
    this.bind = { a: A, b: D, m: 0, t: 0, p, sparkT: 0 };
    for (const f of [A, D]) { f.setState('bind', 99); f.blocking = false; }
    this.pop('Клинч', '#ffffff');
    this.fx.clash(p, 0.9, A.color, D.color);
    this.audio.clash(0.9);
    this.audio.bind(true);
    this.hitstop = 0.08; this.shake(0.35);
  }

  updateBind(dt, inA, inB) {
    const bd = this.bind, { a, b } = bd;
    bd.t += dt;
    // Держим бойцов лицом к лицу
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    a.x = cx - dx * CFG.BIND_DIST / 2; a.z = cz - dz * CFG.BIND_DIST / 2;
    b.x = cx + dx * CFG.BIND_DIST / 2; b.z = cz + dz * CFG.BIND_DIST / 2;
    a.vx = a.vz = b.vx = b.vz = 0;
    a.yaw = yawTo(a, b); b.yaw = yawTo(b, a);
    bd.p = { x: cx, y: 1.35, z: cz };

    const ins = new Map([[a, a === this.fighters[0] ? inA : inB], [b, b === this.fighters[0] ? inA : inB]]);
    for (const [f, inp] of ins) {
      if (inp.dodge && f.stam >= CFG.BIND_ESCAPE_COST) {
        f.spend(CFG.BIND_ESCAPE_COST);
        this.endBind(null);
        return;
      }
      if (inp.mash) {
        bd.m += (f === a ? 1 : -1) * CFG.BIND_PRESS * (0.55 + 0.45 * f.stam / CFG.STAM_MAX);
        f.stam = Math.max(0, f.stam - 2.5); f.stamDelay = CFG.STAM_DELAY;
        this.audio.bind(false);
      }
    }
    bd.sparkT -= dt;
    if (bd.sparkT <= 0) { bd.sparkT = rand(0.05, 0.15); this.fx.sparks(bd.p, 4, a.color, b.color); }

    if (Math.abs(bd.m) >= 1 || bd.t >= CFG.BIND_MAX) {
      const winner = bd.m > 0 ? a : bd.m < 0 ? b : (chance(0.5) ? a : b);
      this.endBind(winner);
    }
  }

  endBind(winner) {
    const { a, b } = this.bind;
    this.bind = null;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    for (const f of [a, b]) f.setState('idle');
    if (winner) {
      const loser = winner === a ? b : a, s = loser === b ? 1 : -1;
      loser.stagger(CFG.STAGGER_BIND);
      loser.vx = dx / l * 4 * s; loser.vz = dz / l * 4 * s;
      this.pop(winner.index === 0 && this.mode === 'bot' ? 'Клинч твой' : 'Клинч проигран', winner.color);
      this.audio.guardBreak();
      this.shake(0.4);
    } else {
      a.vx = -dx / l * 3; a.vz = -dz / l * 3;
      b.vx = dx / l * 3; b.vz = dz / l * 3;
      this.pop('Разошлись', '#cfe3ff');
    }
  }

  onKO(victim, killer) {
    if (victim.dead) return;
    victim.dead = true; victim.deathT = 0; victim.hp = 0;
    victim.setState('dead');
    this.audio.ko(); this.audio.retract();
    if (this.state === 'fight') {
      this.scores[killer.index]++;
      this.state = 'roundEnd'; this.stateT = 0;
      this.slowT = 1.0;
      this.announce('Повержен', 2.2, `Раунд за: ${killer.name}`, killer.color);
    }
  }
}
