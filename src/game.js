'use strict';
// Ядро: фиксированный шаг, раунды, столкновения клинков, урон.
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = canvas ? new Renderer(canvas) : null;
    this.audio = new AudioFX();
    this.fx = new Effects(this);
    this.arena = new Arena();
    this.fighters = [new Fighter(0, 'Ты', CFG.BLADE_COLORS[0]), new Fighter(1, 'Бот', '#ff4058')];
    this.controllers = [null, null];
    this.mode = 'none';
    this.state = 'idle';
    this.scores = [0, 0];
    this.round = 1; this.roundId = 0;
    this.stateT = 0; this.time = 0;
    this.timeScale = 1; this.slowT = 0; this.hitstop = 0;
    this.cam = { x: 800, y: 470, zoom: 1, shake: 0 };
    this.clashCd = 0;
    this.paused = false;
    this.announcement = null;
    this.onMatchEnd = null;
    this.acc = 0; this.last = 0;
    this.neutralInput = { move: 0, jump: false, down: false, dash: false, push: false, power: false, aim: 0 };
  }

  run() {
    this.last = performance.now();
    const loop = now => { this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
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
    const [a, b] = this.fighters, sp = this.arena.spawns;
    a.reset(sp[0].x, sp[0].y, 1);
    b.reset(sp[1].x, sp[1].y, -1);
    this.state = 'intro'; this.stateT = 0;
    this.fx.clear();
    this.slowT = 0; this.timeScale = 1; this.hitstop = 0; this.ignited = false;
    this.announce(`Раунд ${this.round}`, 1.2, this.round > 1 ? `${this.scores[0]} : ${this.scores[1]}` : '');
  }

  announce(text, dur = 1.2, sub = '', color = '#ffffff') {
    this.announcement = { text, sub, t: 0, dur, color };
  }

  shake(v) { this.cam.shake = Math.min(1, this.cam.shake + v); }

  frame(now) {
    const realDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.paused && this.state !== 'idle') {
      if (this.hitstop > 0) this.hitstop -= realDt;
      else {
        if (this.slowT > 0) { this.slowT -= realDt; this.timeScale = 0.25; }
        else this.timeScale = Math.min(1, this.timeScale + realDt * 2.5);
        this.acc += realDt * this.timeScale;
        let n = 0;
        while (this.acc >= CFG.DT && n < 12) { this.step(CFG.DT); this.acc -= CFG.DT; n++; }
        if (n >= 12) this.acc = 0;
      }
      if (this.announcement) {
        this.announcement.t += realDt;
        if (this.announcement.t > this.announcement.dur) this.announcement = null;
      }
    }
    this.updateAudio();
    if (this.renderer) this.renderer.draw(this);
  }

  step(dt) {
    this.time += dt; this.stateT += dt;
    const [A, B] = this.fighters;
    const inA = this.getInput(0, dt), inB = this.getInput(1, dt);
    A.update(dt, inA, B, this);
    B.update(dt, inB, A, this);
    this.separate(A, B);

    this.clashCd = Math.max(0, this.clashCd - dt);
    const h = dt / CFG.SUBSTEPS;
    for (let k = 0; k < CFG.SUBSTEPS; k++) {
      A.saberStep(h); B.saberStep(h);
      this.resolveSabers(A, B, h);
    }
    A.recordTrail(); B.recordTrail();

    for (const f of this.fighters) if (!f.out && f.y > CFG.FALL_Y) this.onRingOut(f);

    this.updateState(dt);
    this.fx.update(dt);
    this.updateCamera(dt);
  }

  getInput(i, dt) {
    const c = this.controllers[i];
    if (!c) return this.neutralInput;
    return c.getInput(this.fighters[i], this.fighters[1 - i], this, dt);
  }

  updateState(dt) {
    if (this.state === 'intro') {
      if (!this.ignited && this.stateT > 0.45) { this.ignited = true; this.audio.ignite(); }
      if (this.ignited) for (const f of this.fighters) f.ignite = Math.min(1, f.ignite + dt * 3.5);
      if (this.stateT > 1.35) { this.state = 'fight'; this.stateT = 0; this.announce('Бой!', 0.7); }
    } else if (this.state === 'roundEnd') {
      for (const f of this.fighters) if (f.dead) f.ignite = Math.max(0, f.ignite - dt * 3);
      if (this.stateT > 2.4) {
        const w = this.scores.findIndex(s => s >= CFG.ROUNDS_TO_WIN);
        if (w >= 0) {
          this.state = 'matchEnd'; this.stateT = 0;
          if (this.onMatchEnd) this.onMatchEnd(w);
        } else { this.round++; this.startRound(); }
      }
    }
  }

  separate(A, B) {
    if (!A.alive || !B.alive || Math.abs(A.y - B.y) > 70) return;
    const dx = B.x - A.x, min = 34;
    if (Math.abs(dx) < min) {
      const push = (min - Math.abs(dx)) / 2;
      const sg = dx === 0 ? 1 : sign(dx);
      A.x -= sg * push; B.x += sg * push;
    }
  }

  resolveSabers(A, B, h) {
    if (this.state !== 'fight' || !A.alive || !B.alive) return;
    const a = A.blade(), b = B.blade();
    const r = closestSegSeg(a.base, a.tip, b.base, b.tip);
    if (r.dist < CFG.BLADE_R * 2) this.handleClash(A, B, { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 });
    this.tryHit(A, B, h);
    this.tryHit(B, A, h);
  }

  // Направление, в которое удар толкает чужой клинок (знак момента силы)
  bladeKick(victim, cp, v) {
    const s = victim.shoulder;
    return sign((cp.x - s.x) * v.y - (cp.y - s.y) * v.x) || 1;
  }

  handleClash(A, B, cp) {
    const sA = A.rotSpeedAt(cp), sB = B.rotSpeedAt(cp);
    // Клинки твёрдые: откатываем оба на шаг назад, чтобы не проходили насквозь
    A.angle = A.prevAngle; B.angle = B.prevAngle;
    const cols = ['#ffffff', '#fff3c4', '#ffd27a', rgba(A.rgb, 1), rgba(B.rgb, 1)];

    if (this.clashCd > 0) {
      A.angVel *= 0.6; B.angVel *= 0.6;
      if (chance(0.08)) this.fx.sparks(cp.x, cp.y, 2, 250, cols, { size: 0.8 });
      return;
    }

    const strong = sA >= sB ? A : B, weak = strong === A ? B : A;
    const sS = Math.max(sA, sB), sW = Math.min(sA, sB);

    // Сцепка: оба клинка почти неподвижны — давят друг на друга, сыплются искры
    if (sS < CFG.BIND_SPEED) {
      A.angVel *= 0.3; B.angVel *= 0.3;
      this.clashCd = 0.06;
      this.fx.sparks(cp.x, cp.y, 3, 260, cols, { size: 0.8 });
      if (chance(0.3)) this.audio.bind();
      return;
    }

    this.clashCd = 0.12;
    const inten = clamp(sS / 1600, 0.25, 1);
    const vS = strong.pointVel(cp), vW = weak.pointVel(cp);
    const opposing = vS.x * vW.x + vS.y * vW.y < 0;

    if (opposing && sW > 220) {
      if (sW >= sS * 0.6) {
        // Встречный размен: оба отлетают
        A.angVel *= -0.5; B.angVel *= -0.5;
        A.stagger = Math.max(A.stagger, 0.1); B.stagger = Math.max(B.stagger, 0.1);
        const d = sign(B.x - A.x) || 1;
        A.vx -= d * 240 * inten; B.vx += d * 240 * inten;
        this.fx.clash(cp, inten, cols);
        this.shake(0.35 * inten + 0.1);
        this.audio.clash(inten);
        this.hitstop = Math.max(this.hitstop, 0.045);
      } else {
        // Парирование: встречное движение более слабым клинком сбивает атакующего
        strong.angVel *= -0.6;
        strong.stagger = Math.max(strong.stagger, 0.42);
        weak.angVel *= 0.3;
        weak.focus = Math.min(CFG.FOCUS_MAX, weak.focus + 10);
        this.fx.clash(cp, Math.min(1, inten * 1.3), cols);
        this.fx.text(cp.x, cp.y - 30, 'Парирование', weak.color, 20);
        this.shake(0.45);
        this.audio.clash(1, true);
        this.hitstop = Math.max(this.hitstop, 0.08);
      }
    } else {
      // Блок: стоящий клинок принимает удар, платит фокусом
      const cost = (5 + 14 * inten) * (strong.power ? 1.7 : 1);
      weak.focus -= cost; weak.focusDelay = CFG.FOCUS_DELAY;
      strong.angVel *= -0.35;
      strong.stagger = Math.max(strong.stagger, 0.13);
      weak.angVel *= 0.25;
      this.fx.clash(cp, inten * 0.8, cols);
      this.audio.clash(inten * 0.8);
      this.shake(0.25 * inten);
      this.hitstop = Math.max(this.hitstop, 0.03);
      if (weak.focus <= 0) {
        weak.focus = 0;
        weak.stagger = 0.7;
        weak.angVel = this.bladeKick(weak, cp, vS) * 12;
        this.fx.text(cp.x, cp.y - 30, 'Блок пробит', strong.color, 22);
        this.audio.guardBreak();
        this.hitstop = 0.1;
        this.shake(0.5);
      }
    }
  }

  tryHit(A, B, h) {
    if (this.state !== 'fight' || !A.alive || !B.alive || A.ignite < 0.5) return;
    const s = A.blade();
    for (const part of B.parts()) {
      const r = closestSegSeg(s.base, s.tip, { x: part.ax, y: part.ay }, { x: part.bx, y: part.by });
      if (r.dist >= part.r + CFG.BLADE_R) continue;
      const cp = { x: r.x1, y: r.y1 };
      const v = A.pointVel(cp);
      const rvx = v.x - B.vx, rvy = v.y - B.vy;
      const sp = Math.hypot(rvx, rvy);
      if (sp > CFG.HIT_MIN_SPEED && B.hitCd <= 0) {
        const dmg = clamp((sp - 250) * CFG.DMG_K, CFG.DMG_MIN, CFG.DMG_MAX) * part.mul * (A.power ? CFG.POWER_DMG_MUL : 1);
        this.damage(B, A, dmg, cp, rvx / sp, rvy / sp, part.name);
      } else if (sp <= CFG.HIT_MIN_SPEED) {
        // Медленное касание прожигает
        B.hp -= CFG.BURN_DPS * h;
        if (chance(0.06)) this.fx.smoke(cp.x, cp.y);
        if (chance(0.02)) this.audio.burn();
        if (B.hp <= 0) this.onKO(B, A);
      }
      return;
    }
  }

  damage(B, A, dmg, cp, nx, ny, part) {
    B.hp -= dmg;
    B.hitCd = 0.3; B.flash = 0.18;
    B.stagger = Math.max(B.stagger, 0.22);
    B.vx += nx * Math.min(420, 120 + dmg * 7);
    B.vy -= 160;
    this.hitstop = Math.max(this.hitstop, 0.05 + dmg * 0.0025);
    this.shake(0.2 + dmg / 80);
    this.fx.hit(cp, A.rgb, nx, ny, dmg);
    this.fx.text(cp.x, cp.y - 20, String(Math.round(dmg)), part === 'head' ? '#ffd23f' : '#ffffff', part === 'head' ? 26 : 20, 0.7);
    this.audio.hit(clamp(dmg / 50, 0, 1));
    if (B.hp <= 0) this.onKO(B, A);
  }

  resolvePush(A, B) {
    this.fx.wave(A);
    this.audio.push();
    if (!B.alive) return;
    const dx = B.x - A.x, dy = B.y - A.y;
    const d = Math.hypot(dx, dy);
    const inFront = sign(dx) === A.facing || Math.abs(dx) < 30;
    if (d > CFG.PUSH_RANGE || !inFront) return;
    if (B.pushWindup > 0) {
      // Два импульса навстречу гасят друг друга
      B.pushWindup = 0;
      A.vx = -A.facing * 450; B.vx = A.facing * 450;
      this.fx.text((A.x + B.x) / 2, A.y - 130, 'Отражено', '#cfe3ff', 22);
      this.shake(0.4);
      return;
    }
    const f = 1 - (d / CFG.PUSH_RANGE) * 0.5;
    B.vx = A.facing * CFG.PUSH_FORCE * f * (B.onGround ? 1 : 1.15);
    B.vy = -(380 * f + 120);
    B.onGround = false;
    B.dashT = 0;
    B.stagger = Math.max(B.stagger, 0.45);
    B.angVel += rand(-16, 16);
    this.shake(0.4);
    this.hitstop = Math.max(this.hitstop, 0.04);
  }

  onKO(victim, killer) {
    if (victim.dead || victim.out) return;
    victim.dead = true; victim.deathT = 0; victim.hp = 0;
    this.audio.ko(); this.audio.retract();
    if (this.state === 'fight') this.endRound(killer, 'ko');
  }

  onRingOut(f) {
    f.out = true;
    if (this.state === 'fight') this.endRound(this.fighters[1 - f.index], 'out');
  }

  endRound(winner, how) {
    this.scores[winner.index]++;
    this.state = 'roundEnd'; this.stateT = 0;
    this.slowT = how === 'ko' ? 0.9 : 0.4;
    const title = how === 'out' ? 'За край!' : 'Повержен';
    this.announce(title, 2.0, `Раунд за: ${winner.name}`, winner.color);
  }

  updateCamera(dt) {
    const [A, B] = this.fighters;
    const tx = (A.x + B.x) / 2 - (this.mode === 'demo' ? 260 / this.cam.zoom : 0);
    const ty = Math.min((A.y + B.y) / 2 - 95, 560);
    const d = Math.hypot(A.x - B.x, (A.y - B.y) * 1.3);
    const z = clamp(1250 / (d + 620), 0.85, 1.5);
    const k = 1 - Math.exp(-4 * dt);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
    this.cam.zoom = lerp(this.cam.zoom, z, k);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 2.2);
  }

  updateAudio() {
    if (!this.audio.ctx) return;
    const vol = this.paused ? 0 : this.mode === 'demo' ? 0.3 : 1;
    this.fighters.forEach((f, i) => {
      this.audio.setHum(i, f.angVel, f.ignite, f.power, (f.x - this.cam.x) / 600, vol);
    });
  }
}
