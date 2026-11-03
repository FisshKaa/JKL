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
    this.round = 1; this.roundId = 0; this.bindId = 0;
    this.time = 0; this.stateT = 0;
    this.hitstop = 0; this.slowT = 0; this.timeScale = 1;
    this.bind = null;
    this.shakeAmt = 0; this.hurt = 0;
    this.popups = [];
    this.announcement = null;
    this.paused = false;
    this.onMatchEnd = null;
    this.acc = 0;
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
    this.fighters.forEach((f, i) => { const s = ARENA.spawns[i]; f.reset(s.x, s.z, s.yaw); });
    this.state = 'intro'; this.stateT = 0;
    this.bind = null; this.hitstop = 0; this.slowT = 0; this.timeScale = 1;
    this.popups = []; this.ignited = false; this.hurt = 0;
    this.announce(`Раунд ${this.round}`, 1.4, this.round > 1 ? `${this.scores[0]} : ${this.scores[1]}` : '');
  }

  announce(text, dur = 1.2, sub = '', color = '#ffffff') { this.announcement = { text, sub, t: 0, dur, color }; }
  pop(text, color = '#ffffff') { this.popups.push({ text, color, t: 0, dur: 1.1 }); }
  shake(v) { this.shakeAmt = Math.min(1, this.shakeAmt + v); }
  isPlayer(f) { return this.mode === 'bot' && f.index === 0; }

  // Реальное время кадра → фиксированные шаги симуляции
  advance(realDt) {
    if (this.paused || this.state === 'idle') return;
    if (this.hitstop > 0) this.hitstop -= realDt;
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
    if (A.dead || B.dead || this.bind || Math.abs(A.y - B.y) > 1.6) return;
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
    const side = isRightSide(dir) ? 0.32 : isLeftSide(dir) ? -0.32 : 0;
    const h = dir === DIR.UP ? 1.55 : isLow(dir) ? 0.9 : 1.3;
    return { x: lerp(A.x, D.x, k) + r.x * side, y: lerp(A.y, D.y, k) + h, z: lerp(A.z, D.z, k) + r.z * side };
  }

  resolveImpact(A, D) {
    const atk = A.attack;
    A.setState('strike', CFG.STRIKE);
    A.recoverDur = CFG.RECOVER;

    const d = dist2d(A, D);
    const f = fwdOf(A.yaw);
    const cosA = d > 0.001 ? ((D.x - A.x) * f.x + (D.z - A.z) * f.z) / d : 1;
    if (D.dead || d > CFG.REACH || cosA < Math.cos(CFG.ARC) || Math.abs(A.y - D.y) > CFG.HEIGHT_REACH) {
      A.recoverDur = CFG.RECOVER_WHIFF;
      return;
    }

    if (D.isInvulnerable()) {
      A.recoverDur = CFG.RECOVER_WHIFF;
      this.pop('Уклонение', '#cfe3ff');
      return;
    }

    const need = mirrorDir(atk.dir);
    const level = Math.abs(A.y - D.y) < 0.4;

    // Встречные удары в одной линии: клинки сцепляются
    if (level && D.state === 'windup' && D.timeToImpact() < 0.13 && D.attack.dir === need) {
      this.startBind(A, D, this.contactPoint(A, D, atk.dir, 0.5));
      return;
    }

    if (D.blocking) {
      if (D.stance === need) {
        const p = this.contactPoint(A, D, atk.dir);
        atk.blocked = true;
        if (this.time - D.blockStart <= CFG.PERFECT) {
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
        if (level && d < 2.3 && A.onGround && D.onGround && chance(CFG.BIND_ON_BLOCK)) this.startBind(A, D, p);
        return;
      }
      this.pop('Не та сторона', '#ffb36b');
    }

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
    this.shake(this.isPlayer(D) ? 0.6 : 0.3);
    if (this.isPlayer(D)) this.hurt = 1;
    if (atk.riposte) this.pop('Контрудар', A.color);
    if (D.hp <= 0) this.onKO(D, A);
  }

  onFeint(f) {
    if (f.index === 0 || this.mode === 'demo') this.pop('Финт', '#cfe3ff');
  }

  tryClinch(A, D) {
    if (dist2d(A, D) > CFG.CLINCH_DIST || Math.abs(A.y - D.y) > 0.4 || A.stam < CFG.CLINCH_COST || D.dead) return;
    if (!A.onGround || !D.onGround || D.state === 'dodge' || D.state === 'stagger' || D.state === 'mantle') return;
    A.spend(CFG.CLINCH_COST);
    this.startBind(A, D, { x: (A.x + D.x) / 2, y: A.y + 1.35, z: (A.z + D.z) / 2 });
  }

  // ---------- Клинч: мини-игра на тайминг ----------
  // По кругу бежит стрелка, на круге три зоны. ЛКМ в зоне: центр — 3 очка, край — 2, мимо — минус 1.
  // Чем меньше выносливости, тем быстрее бежит стрелка. Больше очков — клинч твой.
  startBind(A, D, p) {
    const zones = [];
    let guard = 0;
    while (zones.length < 3 && guard++ < 200) {
      const c = rand(0.2, 0.92);
      if (zones.every(z => Math.abs(z.c - c) > 0.17)) zones.push({ c });
    }
    zones.sort((a, b) => a.c - b.c);
    const side = f => ({
      rev: lerp(CFG.BIND_REV_MIN, CFG.BIND_REV_MAX, f.stam / CFG.STAM_MAX),
      score: 0, hits: zones.map(() => 0), misses: 0, flash: null,
    });
    this.bind = { a: A, b: D, t: 0, zones, sa: side(A), sb: side(D), id: ++this.bindId, p, sparkT: 0 };
    for (const f of [A, D]) { f.setState('bind', 99); f.blocking = false; f.flip = null; f.vy = 0; }
    D.y = A.y;
    this.pop('Клинч', '#ffffff');
    this.fx.clash(p, 0.9, A.color, D.color);
    this.audio.clash(0.9);
    this.audio.bind(true);
    this.hitstop = 0.08; this.shake(0.35);
  }

  bindSide(f) { return this.bind ? (this.bind.a === f ? this.bind.sa : this.bind.b === f ? this.bind.sb : null) : null; }

  updateBind(dt, inA, inB) {
    const bd = this.bind, { a, b } = bd;
    bd.t += dt;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    a.x = cx - dx * CFG.BIND_DIST / 2; a.z = cz - dz * CFG.BIND_DIST / 2;
    b.x = cx + dx * CFG.BIND_DIST / 2; b.z = cz + dz * CFG.BIND_DIST / 2;
    a.vx = a.vz = b.vx = b.vz = 0;
    a.yaw = yawTo(a, b); b.yaw = yawTo(b, a);
    bd.p = { x: cx, y: a.y + 1.35, z: cz };

    for (const f of [a, b]) {
      const inp = f === this.fighters[0] ? inA : inB;
      const s = this.bindSide(f);
      if (inp.dodge && f.stam >= CFG.BIND_ESCAPE_COST) {
        f.spend(CFG.BIND_ESCAPE_COST);
        this.endBind(null, 'escape');
        return;
      }
      if (inp.mash && bd.t < s.rev) {
        const frac = bd.t / s.rev;
        const i = bd.zones.findIndex((z, k) => s.hits[k] === 0 && Math.abs(frac - z.c) <= CFG.BIND_ZONE);
        if (i >= 0) {
          const pts = Math.abs(frac - bd.zones[i].c) <= CFG.BIND_PERFECT ? 3 : 2;
          s.hits[i] = pts; s.score += pts;
          s.flash = { text: pts === 3 ? 'Идеально' : 'Есть', t: bd.t, good: true };
          this.audio.bind(false);
          this.fx.sparks(bd.p, pts * 4, a.color, b.color);
        } else {
          s.score = Math.max(0, s.score - 1); s.misses++;
          s.flash = { text: 'Мимо', t: bd.t, good: false };
        }
      }
    }
    bd.sparkT -= dt;
    if (bd.sparkT <= 0) { bd.sparkT = rand(0.06, 0.16); this.fx.sparks(bd.p, 3, a.color, b.color); }

    if (bd.t >= Math.max(bd.sa.rev, bd.sb.rev) + 0.15) {
      const diff = bd.sa.score - bd.sb.score;
      this.endBind(diff > 0 ? a : diff < 0 ? b : null, 'score');
    }
  }

  endBind(winner, why) {
    const bd = this.bind, { a, b } = bd;
    this.bind = null;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    for (const f of [a, b]) f.setState('idle');
    const sA = bd.sa.score, sB = bd.sb.score;
    if (winner) {
      const loser = winner === a ? b : a, s = loser === b ? 1 : -1;
      loser.stagger(CFG.STAGGER_BIND);
      loser.vx = dx / l * 4 * s; loser.vz = dz / l * 4 * s;
      if (Math.abs(sA - sB) >= 4) loser.spend(25);
      const mine = this.mode === 'bot' ? (a.index === 0 ? sA : sB) : sA, theirs = this.mode === 'bot' ? (a.index === 0 ? sB : sA) : sB;
      const youWon = this.mode === 'bot' && winner.index === 0;
      this.pop(this.mode === 'bot' ? `${youWon ? 'Клинч твой' : 'Клинч проигран'} ${mine} : ${theirs}` : `Клинч ${sA} : ${sB}`, winner.color);
      this.audio.guardBreak();
      this.shake(0.4);
    } else {
      a.vx = -dx / l * 3; a.vz = -dz / l * 3;
      b.vx = dx / l * 3; b.vz = dz / l * 3;
      this.pop(why === 'escape' ? 'Вырвался из клинча' : `Ничья в клинче ${sA} : ${sB}`, '#cfe3ff');
    }
  }

  onKO(victim, killer) {
    if (victim.dead) return;
    if (this.bind) this.bind = null;
    victim.dead = true; victim.deathT = 0; victim.hp = 0;
    victim.flip = null;
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
