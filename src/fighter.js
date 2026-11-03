'use strict';
// Боец. Не знает, кто им управляет: на вход получает объект input
// { move, jump, down, dash, push, power, aim } — от клавиатуры, бота или (позже) сети.
class Fighter {
  constructor(index, name, color) {
    this.index = index;
    this.name = name;
    this.setColor(color);
    this.reset(800, 640, 1);
  }

  setColor(c) { this.color = c; this.rgb = hexToRgb(c); }

  reset(x, y, facing) {
    Object.assign(this, {
      x, y, vx: 0, vy: 0, facing,
      onGround: true, ground: null, airJumps: 1, dropT: 0, dropPlat: null,
      hp: CFG.HP_MAX, hpGhost: CFG.HP_MAX, ghostDelay: 0,
      focus: CFG.FOCUS_MAX, focusDelay: 0,
      dead: false, out: false, deathT: 0,
      angVel: 0, power: false, stagger: 0,
      dashT: 0, dashDir: 0, dashCd: 0, ghostT: 0,
      pushCd: 0, pushWindup: 0,
      hitCd: 0, flash: 0, ignite: 0,
      walkPhase: 0, lean: 0,
    });
    this.angle = mirrorAngle(-0.55, facing);
    this.prevAngle = this.angle;
    this.aim = this.angle;
    this.trail = [];
  }

  get alive() { return !this.dead && !this.out; }

  get shoulder() { return { x: this.x + this.lean * 0.85, y: this.y - 64 }; }

  blade() {
    const s = this.shoulder, c = Math.cos(this.angle), n = Math.sin(this.angle);
    const hand = { x: s.x + c * CFG.ARM_LEN, y: s.y + n * CFG.ARM_LEN };
    const base = { x: hand.x + c * CFG.HILT_LEN, y: hand.y + n * CFG.HILT_LEN };
    const len = CFG.BLADE_LEN * this.ignite;
    return { hand, base, tip: { x: base.x + c * len, y: base.y + n * len }, c, n };
  }

  // Скорость точки клинка в мире (тело + вращение вокруг плеча)
  pointVel(p) {
    const s = this.shoulder;
    return { x: this.vx - (p.y - s.y) * this.angVel, y: this.vy + (p.x - s.x) * this.angVel };
  }

  rotSpeedAt(p) {
    const s = this.shoulder;
    return Math.abs(this.angVel) * Math.hypot(p.x - s.x, p.y - s.y);
  }

  parts() {
    const l = this.lean, x = this.x, y = this.y;
    return [
      { name: 'head', ax: x + l, ay: y - 85, bx: x + l, by: y - 85, r: 11, mul: CFG.HEAD_MUL },
      { name: 'torso', ax: x, ay: y - 32, bx: x + l, by: y - 68, r: 14, mul: 1 },
      { name: 'legs', ax: x, ay: y - 30, bx: x, by: y - 3, r: 10, mul: CFG.LEG_MUL },
    ];
  }

  update(dt, inp, opp, game) {
    this.stagger = Math.max(0, this.stagger - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.pushCd = Math.max(0, this.pushCd - dt);
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.dropT = Math.max(0, this.dropT - dt);
    this.focusDelay = Math.max(0, this.focusDelay - dt);
    if (this.dead) this.deathT += dt;

    // «Призрачная» полоска здоровья догоняет реальную с задержкой
    if (this.hpGhost > this.hp) {
      this.ghostDelay -= dt;
      if (this.ghostDelay <= 0) this.hpGhost = approach(this.hpGhost, this.hp, 60 * dt);
    } else { this.hpGhost = this.hp; this.ghostDelay = 0.5; }

    const canAct = this.alive && this.stagger <= 0 && game.controlsEnabled;

    if (this.alive && Math.abs(opp.x - this.x) > 4) this.facing = sign(opp.x - this.x);

    // Ярость (ЛКМ): быстрее и тяжелее клинок, тратит фокус
    this.power = canAct && inp.power && this.focus > 1;
    if (this.power) { this.focus = Math.max(0, this.focus - CFG.POWER_DRAIN * dt); this.focusDelay = 0.3; }
    else if (this.focusDelay <= 0 && this.dashT <= 0) this.focus = Math.min(CFG.FOCUS_MAX, this.focus + CFG.FOCUS_REGEN * dt);

    if (canAct) this.aim = inp.aim;

    // Прыжок и двойной прыжок
    if (canAct && inp.jump) {
      if (this.onGround) {
        this.vy = -CFG.JUMP_V; this.onGround = false;
        game.fx.dust(this.x, this.y, 6); game.audio.jump();
      } else if (this.airJumps > 0) {
        this.airJumps--; this.vy = -CFG.AIR_JUMP_V;
        game.fx.ring(this.x, this.y, 6, 40, 0.3, this.rgb, 2); game.audio.jump();
      }
    }

    // Спрыгнуть с уступа
    if (canAct && inp.down && this.onGround && this.ground && !this.ground.main) {
      this.dropPlat = this.ground; this.dropT = 0.25; this.onGround = false; this.y += 2;
    }

    // Рывок
    if (canAct && inp.dash && this.dashCd <= 0 && this.focus >= CFG.DASH_COST) {
      this.dashDir = inp.move ? sign(inp.move) : -this.facing;
      this.dashT = CFG.DASH_TIME; this.dashCd = CFG.DASH_CD;
      this.focus -= CFG.DASH_COST; this.focusDelay = CFG.FOCUS_DELAY;
      this.vy = Math.min(this.vy, 0) * 0.2;
      game.audio.dash();
    }

    // Импульс (ПКМ / E): короткий замах, потом волна
    if (canAct && inp.push && this.pushCd <= 0 && this.pushWindup <= 0 && this.focus >= CFG.PUSH_COST) {
      this.pushWindup = CFG.PUSH_WINDUP; this.pushCd = CFG.PUSH_CD;
      this.focus -= CFG.PUSH_COST; this.focusDelay = CFG.FOCUS_DELAY;
    }
    if (this.pushWindup > 0) {
      this.pushWindup -= dt;
      if (this.pushWindup <= 0) { this.pushWindup = 0; if (this.alive) game.resolvePush(this, opp); }
    }

    // Горизонтальное движение
    let move = this.alive && game.controlsEnabled ? clamp(inp.move, -1, 1) : 0;
    if (this.stagger > 0) move *= 0.35;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDir * CFG.DASH_V;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.03; game.fx.ghost(this); }
    } else {
      const target = move * CFG.RUN_SPEED;
      if (this.onGround) {
        const a = (move === 0 || sign(target) !== sign(this.vx)) ? CFG.FRICTION : CFG.GROUND_ACC;
        this.vx = approach(this.vx, target, a * dt);
      } else {
        this.vx = approach(this.vx, target, CFG.AIR_ACC * dt * (move === 0 ? 0.35 : 1));
      }
    }

    this.vy = Math.min(CFG.MAX_FALL, this.vy + CFG.GRAVITY * dt * (this.dashT > 0 ? 0.15 : 1));

    const prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Приземление на платформы (односторонние)
    this.onGround = false; this.ground = null;
    if (this.vy >= 0 && !this.out) {
      for (const p of game.arena.platforms) {
        if (p === this.dropPlat && this.dropT > 0) continue;
        if (this.x >= p.x1 - 4 && this.x <= p.x2 + 4 && prevY <= p.y + 0.5 && this.y >= p.y) {
          if (this.vy > 700) game.fx.dust(this.x, p.y, 8);
          this.y = p.y; this.vy = 0; this.onGround = true; this.ground = p; this.airJumps = 1;
          break;
        }
      }
    }

    this.lean = lerp(this.lean, clamp(this.vx / CFG.RUN_SPEED, -1.5, 1.5) * 5, 1 - Math.exp(-10 * dt));
    if (this.onGround) this.walkPhase += Math.abs(this.vx) * dt * 0.045;
  }

  // Шаг клинка: ПД-регулятор тянет лезвие к углу прицела, с ограничением ускорения.
  // Отсюда «вес»: нельзя мгновенно телепортировать клинок, его надо разогнать.
  saberStep(h) {
    const P = this.power ? CFG.SABER_POWER : CFG.SABER;
    let acc;
    const free = this.stagger <= 0 && this.alive;
    if (!free) acc = -this.angVel * 2.5;
    else {
      const d = wrapAngle(this.aim - this.angle);
      acc = clamp(P.kp * d - P.kd * this.angVel, -P.maxAcc, P.maxAcc);
    }
    const vmax = free ? P.maxVel : P.maxVel * 1.4;
    this.angVel = clamp(this.angVel + acc * h, -vmax, vmax);
    this.prevAngle = this.angle;
    this.angle = wrapAngle(this.angle + this.angVel * h);
  }

  recordTrail() {
    const b = this.blade();
    this.trail.push({ bx: b.base.x, by: b.base.y, tx: b.tip.x, ty: b.tip.y });
    if (this.trail.length > 9) this.trail.shift();
  }
}
