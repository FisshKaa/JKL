'use strict';
// Ядро боя. Не знает про three.js: эффекты и звук приходят снаружи через fx и audio.
// Добивания: названия и какие чаще у каких форм
const FINISHER_NAMES = { hand: 'Отсечение кисти', impale: 'Пронзание', spin: 'Удар с разворота', slam: 'Сокрушающий удар', kneel: 'На колени' };
const FINISHER_POOL = {
  shii: ['spin', 'kneel'], makashi: ['hand', 'impale', 'hand'], soresu: ['kneel', 'hand'], ataru: ['spin', 'slam'],
  djemso: ['slam', 'hand'], niman: ['kneel', 'spin'], juyo: ['spin', 'hand'],
};

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
    this.localIdx = 0;          // какой боец «мой» (в онлайне гость — второй)
    this.rngS = 12345;          // общий генератор случайностей: одинаковый у обоих игроков
    this.silent = false;        // при перемотке кадров не повторяем звуки и эффекты
  }

  get isPlay() { return this.mode === 'bot' || this.mode === 'online' || this.mode === 'training'; }

  // Детерминированный генератор (mulberry32): результат зависит только от зерна
  rnd(a = 0, b = 1) {
    let t = (this.rngS = (this.rngS + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
  }
  chance(p) { return this.rnd() < p; }

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
    this.state = 'intro'; this.stateT = 0; this.finisher = null;
    this.bind = null; this.hitstop = 0; this.slowT = 0; this.timeScale = 1;
    this.popups = []; this.ignited = false; this.hurt = 0;
    this.announce(`Раунд ${this.round}`, 1.4, this.round > 1 ? `${this.scores[0]} : ${this.scores[1]}` : '');
  }

  announce(text, dur = 1.2, sub = '', color = '#ffffff') {
    if (this.silent && this.announcement && this.announcement.text === text) return;
    this.announcement = { text, sub, t: 0, dur, color };
  }
  pop(text, color = '#ffffff') { if (!this.silent) this.popups.push({ text, color, t: 0, dur: 1.1 }); }
  shake(v) { if (!this.silent) this.shakeAmt = Math.min(1, this.shakeAmt + v); }
  isPlayer(f) { return this.isPlay && f.index === this.localIdx; }

  // Реальное время кадра → фиксированные шаги симуляции
  advance(realDt) {
    if (this.paused || this.state === 'idle') return;
    if (this.hitstop > 0) this.hitstop -= realDt;
    else {
      if (this.slowT > 0) { this.slowT -= realDt; this.timeScale = 0.3; }
      else this.timeScale = Math.min(1, this.timeScale + realDt * 2);
      this.acc += realDt * this.timeScale * (this.speedMul || 1);
      let n = 0;
      while (this.acc >= CFG.DT && n < 8) { this.step(CFG.DT); this.acc -= CFG.DT; n++; }
      if (n >= 8) this.acc = 0;
    }
    this.visualTick(realDt);
  }

  // Таймеры надписей, тряски и красной виньетки идут в реальном времени
  visualTick(realDt) {
    if (this.announcement) {
      this.announcement.t += realDt;
      if (this.announcement.t > this.announcement.dur) this.announcement = null;
    }
    for (const p of this.popups) p.t += realDt;
    this.popups = this.popups.filter(p => p.t < p.dur);
    this.shakeAmt = Math.max(0, this.shakeAmt - realDt * 2.5);
    this.hurt = Math.max(0, this.hurt - realDt * 1.8);
  }

  // ---------- Состояние для перемотки и сетевой сверки ----------
  saveState() {
    const cf = f => {
      const o = Object.assign({}, f);
      for (const k of ['attack', 'flip', 'wallN', 'ledge', 'mantle', 'disarm', 'wallRun', 'fin']) if (o[k]) o[k] = Object.assign({}, o[k]);
      return o;
    };
    let bind = null;
    if (this.bind) {
      const b = this.bind;
      bind = Object.assign({}, b, { a: b.a.index, b: b.b.index, p: Object.assign({}, b.p), zones: b.zones.map(z => Object.assign({}, z)),
        sa: Object.assign({}, b.sa, { hits: b.sa.hits.slice(), flash: b.sa.flash && Object.assign({}, b.sa.flash) }),
        sb: Object.assign({}, b.sb, { hits: b.sb.hits.slice(), flash: b.sb.flash && Object.assign({}, b.sb.flash) }) });
    }
    return {
      f: this.fighters.map(cf), time: this.time, stateT: this.stateT, state: this.state, scores: this.scores.slice(),
      round: this.round, roundId: this.roundId, bindId: this.bindId, ignited: this.ignited, rngS: this.rngS, bind,
    };
  }

  loadState(S) {
    S.f.forEach((src, i) => {
      const f = this.fighters[i];
      Object.assign(f, src);
      for (const k of ['attack', 'flip', 'wallN', 'ledge', 'mantle', 'disarm', 'wallRun', 'fin']) f[k] = src[k] ? Object.assign({}, src[k]) : src[k];
    });
    Object.assign(this, { time: S.time, stateT: S.stateT, state: S.state, scores: S.scores.slice(), round: S.round, roundId: S.roundId, bindId: S.bindId, ignited: S.ignited, rngS: S.rngS });
    if (S.bind) {
      const b = S.bind;
      this.bind = Object.assign({}, b, { a: this.fighters[b.a], b: this.fighters[b.b], p: Object.assign({}, b.p), zones: b.zones.map(z => Object.assign({}, z)),
        sa: Object.assign({}, b.sa, { hits: b.sa.hits.slice() }), sb: Object.assign({}, b.sb, { hits: b.sb.hits.slice() }) });
    } else this.bind = null;
  }

  // Для отправки по сети: ссылки на коробки арены заменяем номерами
  static packState(S) {
    return JSON.stringify(S, (k, v) => {
      if (v && typeof v === 'object' && 'x1' in v && 'top' in v) return { __box: ARENA.boxes.indexOf(v) };
      return v;
    });
  }
  static unpackState(str) {
    return JSON.parse(str, (k, v) => (v && typeof v === 'object' && '__box' in v ? ARENA.boxes[v.__box] : v));
  }

  // Короткая контрольная сумма: координаты до сантиметра, здоровье до десятых
  hash(S = null) {
    S = S || this.saveState();
    let h = 2166136261;
    const mix = n => { h ^= n | 0; h = Math.imul(h, 16777619); };
    for (const f of S.f) {
      mix(Math.round(f.x * 100)); mix(Math.round(f.y * 100)); mix(Math.round(f.z * 100));
      mix(Math.round(f.hp * 10)); mix(Math.round(f.stam)); mix(f.state.length * 31 + f.state.charCodeAt(0));
    }
    mix(S.scores[0] * 7 + S.scores[1]); mix(S.roundId); mix(S.state.length);
    return h >>> 0;
  }

  step(dt) {
    this.time += dt; this.stateT += dt;
    const [A, B] = this.fighters;
    if (this.mode === 'training' && this.infStam) for (const f of this.fighters) f.stam = CFG.STAM_MAX;
    const inA = this.input(0, dt), inB = this.input(1, dt);
    A.update(dt, inA, B, this);
    B.update(dt, inB, A, this);
    if (this.bind) this.updateBind(dt, inA, inB);
    this.separate(A, B);
    // Сорвался с арены в пропасть
    for (const f of this.fighters) if (!f.dead && f.y < ARENA.fallY) this.onKO(f, this.fighters[1 - f.index], 'fall');
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
    const SA = styleSim(A), SD = styleSim(D);
    const reach = (atk.dir === DIR.THRUST ? CFG.THRUST_REACH : CFG.REACH) + SA.reach;
    if (D.dead || d > reach || cosA < Math.cos(CFG.ARC + SA.arc) || Math.abs(A.y - D.y) > CFG.HEIGHT_REACH) {
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
      if (D.stance === need || atk.dir === DIR.THRUST) {   // укол принимается любой стойкой
        const p = this.contactPoint(A, D, atk.dir);
        atk.blocked = true;
        D.blockFxT = this.time; D.blockFxPerfect = false;   // для анимации отбива
        if (this.time - D.blockStart <= CFG.PERFECT + SD.perfect) {
          D.blockFxPerfect = true;
          A.stagger(CFG.STAGGER_PERFECT);
          D.riposteT = CFG.RIPOSTE_WINDOW * SD.riposteWin;
          D.stam = Math.min(CFG.STAM_MAX, D.stam + 10);
          this.pop('Мастерский блок', D.color);
          this.fx.clash(p, 1, A.color, D.color);
          this.audio.clash(1, true);
          this.hitstop = 0.11; this.shake(0.45);
          return;
        }
        D.spend((atk.riposte ? CFG.BLOCK_COST_RIPOSTE : CFG.BLOCK_COST) * (atk.dir === DIR.THRUST ? CFG.THRUST_BLOCK_MUL : 1) * (atk.heavy ? 1.5 : 1) * SD.block);
        if (atk.heavy) {
          // Тяжёлый удар пробивает обычный блок; спасает только мастерский
          D.stagger(CFG.STAGGER_BREAK);
          this.pop('Тяжёлый удар пробил блок', A.color);
          this.fx.clash(p, 1, A.color, D.color);
          this.audio.guardBreak();
          this.hitstop = 0.1; this.shake(0.45);
          return;
        }
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
        if (level && d < 2.3 && A.onGround && D.onGround && this.chance(CFG.BIND_ON_BLOCK)) this.startBind(A, D, p);
        return;
      }
      this.pop('Не та сторона', '#ffb36b');
    }

    let dmg = CFG.DMG * CFG.DIR_MUL[atk.dir] * SA.dmg;
    if (atk.dir === DIR.THRUST) dmg *= SA.thrustDmg;
    if (atk.riposte) dmg *= CFG.RIPOSTE_MUL * SA.riposte;
    if (atk.combo >= 2) dmg *= CFG.COMBO_MUL;
    if (atk.heavy) dmg *= CFG.HEAVY_MUL * SA.heavy;
    if (atk.dive) dmg *= CFG.DIVE_MUL * SA.dive;
    D.hp -= dmg;
    D.hitFlash = 0.2;
    D.hitFxT = this.time; D.hitFxSide = isRightSide(atk.dir) ? 1 : isLeftSide(atk.dir) ? -1 : 0;
    D.stagger(CFG.STAGGER_HIT);
    D.vx += f.x * 2.6; D.vz += f.z * 2.6;
    const p = this.contactPoint(A, D, atk.dir, 0.86);
    this.fx.hit(p, A.color, dmg);
    this.audio.hit(clamp(dmg / 25, 0, 1));
    this.hitstop = 0.07 + dmg * 0.002;
    this.shake(this.isPlayer(D) ? 0.6 : 0.3);
    if (this.isPlayer(D) && !this.silent) this.hurt = 1;
    if (atk.riposte) this.pop('Контрудар', A.color);
    else if (atk.heavy) this.pop('Тяжёлый удар', A.color);
    else if (atk.dive) this.pop('Удар в прыжке', A.color);
    if (D.hp <= 0) this.onKO(D, A);
  }

  // Толчок силой: конус перед бойцом; в воздухе соперник не может затормозить
  resolvePush(A, D) {
    const f = fwdOf(A.yaw);
    this.fx.wave({ x: A.x + f.x * 0.5, y: A.y + 1.3, z: A.z + f.z * 0.5 }, f, A.color);
    this.audio.push();
    if (D.dead) return;
    const dx = D.x - A.x, dz = D.z - A.z, d = Math.hypot(dx, dz) || 0.001;
    if (d > CFG.PUSH_RANGE || (dx * f.x + dz * f.z) / d < Math.cos(CFG.PUSH_ARC) || Math.abs(D.y - A.y) > 1.5) return;
    if (D.isInvulnerable()) { this.pop('Увернулся', '#cfe3ff'); return; }
    if (D.state === 'push' && !D.pushFired) {
      // Два толчка навстречу гасят друг друга
      D.setState('idle'); A.stagger(0.3); D.stagger(0.3);
      A.vx -= f.x * 3; A.vz -= f.z * 3; D.vx += f.x * 3; D.vz += f.z * 3;
      this.pop('Толчки погасили друг друга', '#cfe3ff');
      this.shake(0.4);
      return;
    }
    if (this.bind && (this.bind.a === D || this.bind.b === D)) this.bind = null;
    const k = (1 - 0.35 * (d / CFG.PUSH_RANGE)) * styleSim(A).pushForce;
    D.vx = f.x * CFG.PUSH_FORCE * k; D.vz = f.z * CFG.PUSH_FORCE * k;
    D.vy = Math.max(D.vy, CFG.PUSH_UP * k);
    D.onGround = false; D.ledge = null; D.mantle = null;
    D.stagger(CFG.STAGGER_PUSH);
    this.pop('Толчок', A.color);
    this.shake(this.isPlayer(D) ? 0.55 : 0.3);
    if (this.isPlayer(D) && !this.silent) this.hurt = Math.max(this.hurt, 0.4);
    this.hitstop = Math.max(this.hitstop, 0.06);
  }

  // Жёсткое приземление: урон от высоты и оглушение (перекат на Shift спасает)
  fallDamage(f, impact) {
    const dmg = Math.min(40, (impact - CFG.FALL_SAFE) * CFG.FALL_DMG + 4);
    f.hp -= dmg;
    f.stagger(0.6);
    this.pop('Жёсткое приземление', '#ffb36b');
    this.shake(this.isPlayer(f) ? 0.5 : 0.2);
    if (this.isPlayer(f) && !this.silent) this.hurt = Math.max(this.hurt, 0.7);
    this.audio.hit(0.4);
    if (f.hp <= 0) this.onKO(f, this.fighters[1 - f.index], 'crash');
  }

  // Пинок: слабый, но сбивает любую защиту клинком и отталкивает
  resolveKick(A, D) {
    if (D.dead) return;
    const f = fwdOf(A.yaw);
    const dx = D.x - A.x, dz = D.z - A.z, d = Math.hypot(dx, dz) || 0.001;
    if (d > CFG.KICK_RANGE || (dx * f.x + dz * f.z) / d < Math.cos(0.7) || Math.abs(D.y - A.y) > 0.8) return;
    if (D.isInvulnerable()) { this.pop('Увернулся', '#cfe3ff'); return; }
    if (this.bind) return;
    const wasBlocking = D.blocking;
    D.hp -= CFG.KICK_DMG;
    D.stagger(CFG.STAGGER_KICK);
    D.vx += f.x * CFG.KICK_PUSH; D.vz += f.z * CFG.KICK_PUSH;
    this.fx.hit({ x: lerp(A.x, D.x, 0.8), y: D.y + 1.0, z: lerp(A.z, D.z, 0.8) }, '#ffffff', 4);
    this.audio.hit(0.35);
    this.pop(wasBlocking ? 'Пинок сбил защиту' : 'Пинок', A.color);
    this.shake(this.isPlayer(D) ? 0.4 : 0.2);
    if (this.isPlayer(D) && !this.silent) this.hurt = Math.max(this.hurt, 0.5);
    if (D.hp <= 0) this.onKO(D, A);
  }

  // Клинок вылетает из рук проигравшего клинч
  disarm(f, awayX, awayZ) {
    const side = this.rnd(-1.5, 1.5);
    f.disarm = { x: f.x, y: f.y + 1.3, z: f.z, vx: awayX * 3.2 - awayZ * side, vy: 4.2, vz: awayZ * 3.2 + awayX * side, landed: false, lost: false, t: 0 };
    if (f.attack) f.attack = null;
    this.pop(this.isPlayer(f) ? 'Клинок выбит! Подбери или R — притянуть' : 'Клинок выбит', '#ffd23f');
    this.audio.guardBreak();
  }

  onFeint(f) {
    if (f.index === this.localIdx || this.mode === 'demo') this.pop('Финт', '#cfe3ff');
  }

  tryClinch(A, D) {
    if (dist2d(A, D) > CFG.CLINCH_DIST || Math.abs(A.y - D.y) > 0.4 || A.stam < CFG.CLINCH_COST || D.dead || A.disarm || D.disarm) return;
    if (!A.onGround || !D.onGround || D.state === 'dodge' || D.state === 'stagger' || D.state === 'hang' || D.state === 'climb' || D.state === 'vault') return;
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
      const c = this.rnd(0.2, 0.92);
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
    if (bd.sparkT <= 0) { bd.sparkT = this.rnd(0.06, 0.16); this.fx.sparks(bd.p, 3, a.color, b.color); }

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
      if (Math.abs(sA - sB) >= CFG.DISARM_MARGIN) { loser.spend(25); this.disarm(loser, dx / l * s, dz / l * s); }
      const li = this.localIdx, mine = this.isPlay ? (a.index === li ? sA : sB) : sA, theirs = this.isPlay ? (a.index === li ? sB : sA) : sB;
      const youWon = this.isPlay && winner.index === li;
      this.pop(this.isPlay ? `${youWon ? 'Клинч твой' : 'Клинч проигран'} ${mine} : ${theirs}` : `Клинч ${sA} : ${sB}`, winner.color);
      this.audio.guardBreak();
      this.shake(0.4);
    } else {
      a.vx = -dx / l * 3; a.vz = -dz / l * 3;
      b.vx = dx / l * 3; b.vz = dz / l * 3;
      this.pop(why === 'escape' ? 'Вырвался из клинча' : `Ничья в клинче ${sA} : ${sB}`, '#cfe3ff');
    }
  }

  pickFinisher(killer) {
    const a = killer.attack;
    if (killer.state === 'kick') return 'kneel';
    if (a && a.dir === DIR.THRUST) return 'impale';
    if (a && (a.heavy || a.dive)) return 'slam';
    const pool = FINISHER_POOL[killer.style] || ['kneel', 'spin'];
    return pool[Math.floor(this.rnd(0, pool.length - 0.001))];
  }

  onKO(victim, killer, how) {
    if (victim.dead) return;
    if (this.mode === 'training') {
      // В тренировке никто не умирает: здоровье восполняется, упавший возвращается на место
      victim.hp = CFG.HP_MAX;
      if (how === 'fall') { const sp = ARENA.spawns[victim.index]; victim.x = sp.x; victim.z = sp.z; victim.y = 0; victim.vx = victim.vy = victim.vz = 0; this.pop('Возвращён на арену', '#cfe3ff'); }
      else this.pop(this.isPlayer(victim) ? 'Здоровье восполнено' : 'Манекен восстановлен', '#cfe3ff');
      return;
    }
    if (this.bind) this.bind = null;
    victim.dead = true; victim.deathT = 0; victim.hp = 0;
    victim.flip = null;
    // Добивание: короткая сценка. Тип — по последнему удару и форме победителя
    const fin = !how && this.state === 'fight' ? this.pickFinisher(killer) : null;
    const prevState = victim.state;
    victim.setState('dead');
    if (fin) {
      const sideDir = killer.attack ? killer.attack.dir : DIR.RIGHT;
      victim.fin = { type: fin, t0: this.time, role: 'victim', kx: killer.x, kz: killer.z, kyaw: killer.yaw, side: isLeftSide(sideDir) ? -1 : 1, prev: prevState };
      killer.fin = { type: fin, t0: this.time, role: 'killer', side: victim.fin.side };
      this.finisher = { type: fin, t0: this.time, killer: killer.index, victim: victim.index };
      this.pop(FINISHER_NAMES[fin], killer.color);
    }
    this.audio.ko(); this.audio.retract();
    if (this.state === 'fight') {
      this.scores[killer.index]++;
      this.state = 'roundEnd'; this.stateT = 0;
      this.slowT = 1.0;
      this.announce(how === 'fall' ? 'В пропасть' : how === 'crash' ? 'Разбился' : 'Повержен', 2.2, `Раунд за: ${killer.name}`, killer.color);
    }
  }
}
