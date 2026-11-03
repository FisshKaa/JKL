'use strict';
// Боец — чистая логика без графики. На вход каждый шаг получает input:
// { mx, mz, stance, attack, block, feint, dodge, jump, jumpHeld, clinch, mash, lock, yaw }
// от клавиатуры, бота или (позже) сети.
class Fighter {
  constructor(index, name, color) {
    this.index = index;
    this.name = name;
    this.color = color;
    this.windupMul = 1;
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, speed: 0, walkPhase: 0,
      onGround: true, ground: null, airJumps: 1, wallJumps: 0,
      forcing: false, forceT: 0, forcePaid: false,
      flip: null, wallT: 9, wallN: { x: 0, z: 0 }, wallBox: null, mantle: null, landT: 9,
      hp: CFG.HP_MAX, stam: CFG.STAM_MAX, stamDelay: 0,
      stance: DIR.RIGHT, blocking: false, blockStart: -10,
      state: 'idle', stateT: 0, dur: 0, recoverDur: CFG.RECOVER,
      attack: null, attackId: 0, lastDir: -1, comboIdx: 0, riposteT: 0,
      dead: false, deathT: 0, hitFlash: 0, ignite: 0,
    });
  }

  get alive() { return !this.dead; }

  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.dur = dur; }

  timeToImpact() { return this.state === 'windup' ? this.dur - this.stateT : Infinity; }

  isInvulnerable() {
    if (this.state === 'dodge' && this.stateT >= CFG.IFRAMES[0] && this.stateT <= CFG.IFRAMES[1]) return true;
    return !!this.flip && this.flip.t >= CFG.FLIP_IFRAMES[0] && this.flip.t <= CFG.FLIP_IFRAMES[1];
  }

  spend(v) { this.stam = Math.max(0, this.stam - v); this.stamDelay = CFG.STAM_DELAY; }

  stagger(dur) {
    if (this.dead) return;
    this.mantle = null;
    this.setState('stagger', dur);
    this.blocking = false;
  }

  // Направление ввода в мире
  moveDir(inp) {
    let mx = clamp(inp.mx || 0, -1, 1), mz = clamp(inp.mz || 0, -1, 1);
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    const f = fwdOf(this.yaw), r = rightOf(this.yaw);
    return { x: f.x * mz + r.x * mx, z: f.z * mz + r.z * mx, mx, mz, len: Math.min(1, l) };
  }

  startAttack(game, combo) {
    const dir = this.stance;
    let w = CFG.WINDUP;
    const riposte = this.riposteT > 0;
    if (riposte) { w = CFG.WINDUP_RIPOSTE; this.riposteT = 0; this.comboIdx = 0; }
    else if (combo) { this.comboIdx++; w = dir !== this.lastDir ? CFG.WINDUP_COMBO : CFG.WINDUP * 0.95; }
    else this.comboIdx = 0;
    w *= this.windupMul;
    this.attack = { dir, windup: w, riposte, combo: this.comboIdx, id: ++this.attackId, swung: false, blocked: false };
    this.lastDir = dir;
    this.blocking = false;
    this.spend(CFG.ATTACK_COST);
    this.setState('windup', w);
  }

  startDodge(inp, game) {
    let mx = inp.mx || 0, mz = inp.mz || 0;
    if (!mx && !mz) mz = -1;
    const l = Math.hypot(mx, mz);
    const f = fwdOf(this.yaw), r = rightOf(this.yaw);
    this.vx = (f.x * mz + r.x * mx) / l * CFG.DODGE_SPEED;
    this.vz = (f.z * mz + r.z * mx) / l * CFG.DODGE_SPEED;
    this.blocking = false;
    this.spend(CFG.DODGE_COST);
    this.setState('dodge', CFG.DODGE);
    game.audio.dash();
  }

  startFlip(type, game) {
    this.flip = { type, t: 0 };
    this.blocking = false;
    game.audio.flip();
  }

  // Прыжок, сальто, отскок от стены
  tryJump(inp, game) {
    if (this.onGround) {
      this.vy = CFG.JUMP_V;
      this.onGround = false; this.ground = null;
      this.forcing = true; this.forceT = 0; this.forcePaid = false;
      game.audio.jump();
      return;
    }
    const md = this.moveDir(inp);
    if (this.wallT < 0.2 && this.wallJumps < CFG.WALLJUMP_MAX && this.stam >= CFG.FLIP_COST) {
      this.vy = CFG.WALLJUMP_V;
      this.vx = this.wallN.x * CFG.WALLJUMP_PUSH + md.x * 1.5;
      this.vz = this.wallN.z * CFG.WALLJUMP_PUSH + md.z * 1.5;
      this.wallJumps++; this.airJumps = 1; this.wallT = 9;
      this.spend(CFG.FLIP_COST);
      const f = fwdOf(this.yaw), r = rightOf(this.yaw);
      const fw = this.wallN.x * f.x + this.wallN.z * f.z, rt = this.wallN.x * r.x + this.wallN.z * r.z;
      this.startFlip(Math.abs(fw) >= Math.abs(rt) ? (fw < 0 ? 'back' : 'front') : (rt > 0 ? 'right' : 'left'), game);
      return;
    }
    if (this.airJumps > 0 && this.stam >= CFG.FLIP_COST) {
      this.airJumps--;
      this.vy = CFG.FLIP_V;
      const f = fwdOf(this.yaw);
      let type = 'back', px = -f.x, pz = -f.z;
      if (md.len > 0.2) {
        px = md.x / md.len; pz = md.z / md.len;
        type = Math.abs(md.mz) >= Math.abs(md.mx) ? (md.mz > 0 ? 'front' : 'back') : (md.mx > 0 ? 'right' : 'left');
      }
      this.vx += px * CFG.FLIP_PUSH; this.vz += pz * CFG.FLIP_PUSH;
      this.spend(CFG.FLIP_COST);
      this.startFlip(type, game);
    }
  }

  update(dt, inp, opp, game) {
    this.stateT += dt;
    this.stamDelay = Math.max(0, this.stamDelay - dt);
    this.riposteT = Math.max(0, this.riposteT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wallT += dt; this.landT += dt;
    if (this.flip) { this.flip.t += dt; if (this.flip.t >= CFG.FLIP_DUR) this.flip = null; }

    if (this.dead) {
      this.deathT += dt;
      this.vx *= 0.9; this.vz *= 0.9;
      this.physics(dt, game, {});
      return;
    }

    const active = game.controlsEnabled;

    if (this.state !== 'bind' && this.state !== 'mantle') {
      if (inp.lock || !active || inp.yaw == null) {
        const rate = this.state === 'windup' ? CFG.TURN_ATTACK : this.state === 'stagger' ? 2 : CFG.TURN;
        this.yaw = turnToward(this.yaw, yawTo(this, opp), rate * dt);
      } else this.yaw = inp.yaw;
    }

    if (!active) {
      this.blocking = false;
      if (this.onGround) { this.vx = approach(this.vx, 0, CFG.ACC * dt); this.vz = approach(this.vz, 0, CFG.ACC * dt); }
      this.physics(dt, game, {});
      return;
    }

    const free = this.state === 'idle' || this.state === 'recover' || this.state === 'dodge' || this.state === 'feint';
    if (free && inp.stance != null && inp.stance !== this.stance) {
      this.stance = inp.stance;
      if (this.blocking) this.blockStart = game.time; // перевод блока на другую сторону = новый блок
    }
    const wantBlock = !!inp.block && this.state === 'idle' && this.stam > 0 && !this.flip;
    if (wantBlock && !this.blocking) this.blockStart = game.time;
    this.blocking = wantBlock;

    switch (this.state) {
      case 'idle':
        if (inp.jump) this.tryJump(inp, game);
        else if (inp.attack && this.stam >= CFG.ATTACK_COST && !this.flip) this.startAttack(game, false);
        else if (inp.dodge && this.onGround && this.stam >= CFG.DODGE_COST) this.startDodge(inp, game);
        else if (inp.clinch) game.tryClinch(this, opp);
        break;
      case 'windup':
        if (!this.attack.swung && this.stateT >= this.dur - CFG.SWEEP_PRE) {
          this.attack.swung = true;
          game.audio.swing(this.attack.riposte);
        }
        if (inp.feint && !this.attack.riposte && this.stateT < this.dur * 0.8 && this.stam >= CFG.FEINT_COST) {
          this.spend(CFG.FEINT_COST);
          this.setState('feint', CFG.FEINT);
          game.onFeint(this);
        } else if (this.stateT >= this.dur) game.resolveImpact(this, opp);
        break;
      case 'strike':
        if (this.stateT >= CFG.STRIKE) this.setState('recover', this.recoverDur);
        break;
      case 'recover':
        if (this.stateT >= CFG.COMBO_OPEN && inp.jump) { this.setState('idle'); this.tryJump(inp, game); }
        else if (this.stateT >= CFG.COMBO_OPEN && inp.attack && this.stam >= CFG.ATTACK_COST) this.startAttack(game, true);
        else if (this.stateT >= CFG.COMBO_OPEN && inp.dodge && this.onGround && this.stam >= CFG.DODGE_COST) this.startDodge(inp, game);
        else if (this.stateT >= this.dur) this.setState('idle');
        break;
      case 'feint':
      case 'dodge':
      case 'stagger':
        if (this.stateT >= this.dur) this.setState('idle');
        break;
    }

    // Силовой прыжок: пока держишь прыжок на взлёте, гравитация слабее
    if (this.forcing) {
      if (!inp.jumpHeld || this.vy <= 0 || this.forceT > CFG.FORCE_TIME) this.forcing = false;
      else {
        this.forceT += dt;
        if (!this.forcePaid && this.forceT > 0.12) {
          if (this.stam >= CFG.FORCE_COST) { this.spend(CFG.FORCE_COST); this.forcePaid = true; }
          else this.forcing = false;
        }
      }
    }

    // Горизонтальное движение
    if (this.state === 'dodge') {
      const k = Math.exp(-5 * dt);
      this.vx *= k; this.vz *= k;
    } else if (this.state !== 'bind' && this.state !== 'mantle') {
      const mul = { idle: 1, windup: 0.45, strike: 0.3, recover: 0.6, feint: 0.7, stagger: 0.2 }[this.state] ?? 1;
      const md = this.moveDir(inp);
      const sp = mul * (this.blocking ? 0.6 : 1);
      const fwd = md.mz * (md.mz > 0 ? CFG.WALK : CFG.BACK) * sp, side = md.mx * CFG.STRAFE * sp;
      const f = fwdOf(this.yaw), r = rightOf(this.yaw);
      const tx = f.x * fwd + r.x * side, tz = f.z * fwd + r.z * side;
      if (this.onGround) {
        this.vx = approach(this.vx, tx, CFG.ACC * dt);
        this.vz = approach(this.vz, tz, CFG.ACC * dt);
      } else if (md.len > 0.1) {
        // В воздухе только подруливаем, инерция сохраняется
        this.vx = approach(this.vx, tx * 1.2, CFG.AIR_ACC * dt);
        this.vz = approach(this.vz, tz * 1.2, CFG.AIR_ACC * dt);
      }
    }

    this.physics(dt, game, inp);

    const busy = this.state === 'windup' || this.state === 'strike' || this.state === 'dodge' || this.state === 'bind' || this.state === 'mantle';
    if (this.stamDelay <= 0 && !busy) {
      this.stam = Math.min(CFG.STAM_MAX, this.stam + CFG.STAM_REGEN * (this.blocking ? 0.45 : 1) * dt);
    }
    this.speed = Math.hypot(this.vx, this.vz);
    if (this.onGround) this.walkPhase += this.speed * dt * 4.2;
  }

  physics(dt, game, inp) {
    const R = CFG.RADIUS, A = ARENA;

    // Взбирание: короткая анимация подтягивания на уступ
    if (this.state === 'mantle') {
      const m = this.mantle, k = clamp(this.stateT / this.dur, 0, 1);
      this.y = lerp(m.fy, m.ty, easeOut(Math.min(1, k / 0.6)));
      const h = easeInOut(Math.max(0, (k - 0.35) / 0.65));
      this.x = lerp(m.fx, m.tx, h); this.z = lerp(m.fz, m.tz, h);
      this.vx = this.vz = this.vy = 0;
      if (k >= 1) {
        this.mantle = null; this.onGround = true; this.ground = m.box;
        this.airJumps = 1; this.wallJumps = 0;
        this.setState('idle');
      }
      return;
    }
    if (this.state === 'bind') { this.vy = 0; return; }

    // По горизонтали: стенка арены и коробки
    this.x += this.vx * dt; this.z += this.vz * dt;
    const rr = Math.hypot(this.x, this.z);
    if (rr > CFG.ARENA_R) { this.x *= CFG.ARENA_R / rr; this.z *= CFG.ARENA_R / rr; }

    let wall = null;
    for (const b of A.boxes) {
      if (b.top <= this.y + 0.02) continue;
      const cx = clamp(this.x, b.x1, b.x2), cz = clamp(this.z, b.z1, b.z2);
      const dx = this.x - cx, dz = this.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (this.onGround && b.top - this.y <= CFG.STEP) { this.y = b.top; continue; } // ступенька
      let d = Math.sqrt(d2), nx, nz;
      if (d < 1e-5) {
        const pens = [this.x - b.x1, b.x2 - this.x, this.z - b.z1, b.z2 - this.z];
        const i = pens.indexOf(Math.min(...pens));
        nx = [-1, 1, 0, 0][i]; nz = [0, 0, -1, 1][i]; d = -pens[i];
      } else { nx = dx / d; nz = dz / d; }
      this.x += nx * (R - d); this.z += nz * (R - d);
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) { this.vx -= vn * nx; this.vz -= vn * nz; }
      wall = { b, nx, nz };
    }
    if (wall) { this.wallT = 0; this.wallN = { x: wall.nx, z: wall.nz }; this.wallBox = wall.b; }

    // По вертикали
    const prevY = this.y;
    this.vy -= CFG.GRAVITY * dt * (this.forcing ? CFG.FORCE_GRAV : 1);
    this.y += this.vy * dt;
    const g = A.groundAt(this.x, this.z, prevY + 0.05);
    if (this.y <= g.y) {
      if (!this.onGround) {
        this.landT = 0;
        if (this.vy < -7) game.audio.land();
      }
      this.y = g.y; this.vy = 0;
      this.onGround = true; this.ground = g.box;
      this.airJumps = 1; this.wallJumps = 0; this.forcing = false;
    } else if (this.y > g.y + 0.001) {
      this.onGround = false;
    }

    // Подтянуться на уступ: упёрлись в него в воздухе и держим направление на стену
    if (wall && !this.onGround && game.controlsEnabled && (this.state === 'idle' || this.state === 'recover')) {
      const dh = wall.b.top - this.y;
      const md = this.moveDir(inp);
      const into = -(md.x * wall.nx + md.z * wall.nz);
      if (dh > 0.15 && dh < CFG.MANTLE_REACH && this.vy < 3.5 && into > 0.3) {
        const b = wall.b;
        const tx = clamp(this.x - wall.nx * 0.5, b.x1 + 0.2, b.x2 - 0.2);
        const tz = clamp(this.z - wall.nz * 0.5, b.z1 + 0.2, b.z2 - 0.2);
        this.mantle = { fx: this.x, fy: this.y, fz: this.z, tx, ty: b.top, tz, box: b };
        this.flip = null; this.forcing = false; this.blocking = false;
        this.setState('mantle', CFG.MANTLE_TIME);
        game.audio.jump();
      }
    }
  }
}
