'use strict';
// Боец — чистая логика без графики. На вход каждый шаг получает input:
// { mx, mz, stance, attack, block, feint, dodge, clinch, mash, lock, yaw }
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
      x, z, vx: 0, vz: 0, yaw, speed: 0, walkPhase: 0,
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
    return this.state === 'dodge' && this.stateT >= CFG.IFRAMES[0] && this.stateT <= CFG.IFRAMES[1];
  }

  spend(v) { this.stam = Math.max(0, this.stam - v); this.stamDelay = CFG.STAM_DELAY; }

  stagger(dur) {
    if (this.dead) return;
    this.setState('stagger', dur);
    this.blocking = false;
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
    mx /= l; mz /= l;
    const f = fwdOf(this.yaw), r = rightOf(this.yaw);
    this.vx = (f.x * mz + r.x * mx) * CFG.DODGE_SPEED;
    this.vz = (f.z * mz + r.z * mx) * CFG.DODGE_SPEED;
    this.blocking = false;
    this.spend(CFG.DODGE_COST);
    this.setState('dodge', CFG.DODGE);
    game.audio.dash();
  }

  update(dt, inp, opp, game) {
    this.stateT += dt;
    this.stamDelay = Math.max(0, this.stamDelay - dt);
    this.riposteT = Math.max(0, this.riposteT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    if (this.dead) {
      this.deathT += dt;
      this.vx *= 0.9; this.vz *= 0.9;
      this.integrate(dt);
      return;
    }

    const active = game.controlsEnabled;

    // Поворот: с захватом цели боец сам доворачивается на соперника
    if (this.state !== 'bind') {
      if (inp.lock || !active || inp.yaw == null) {
        const rate = this.state === 'windup' ? CFG.TURN_ATTACK : this.state === 'stagger' ? 2 : CFG.TURN;
        this.yaw = turnToward(this.yaw, yawTo(this, opp), rate * dt);
      } else this.yaw = inp.yaw;
    }

    if (!active) {
      this.blocking = false;
      this.vx = approach(this.vx, 0, CFG.ACC * dt);
      this.vz = approach(this.vz, 0, CFG.ACC * dt);
      this.integrate(dt);
      return;
    }

    // Стойка меняется только когда руки свободны
    const free = this.state === 'idle' || this.state === 'recover' || this.state === 'dodge' || this.state === 'feint';
    if (free && inp.stance != null && inp.stance !== this.stance) {
      this.stance = inp.stance;
      if (this.blocking) this.blockStart = game.time; // перевод блока на другую сторону = новый блок
    }
    const wantBlock = !!inp.block && this.state === 'idle' && this.stam > 0;
    if (wantBlock && !this.blocking) this.blockStart = game.time;
    this.blocking = wantBlock;

    switch (this.state) {
      case 'idle':
        if (inp.attack && this.stam >= CFG.ATTACK_COST) this.startAttack(game, false);
        else if (inp.dodge && this.stam >= CFG.DODGE_COST) this.startDodge(inp, game);
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
        if (this.stateT >= CFG.COMBO_OPEN && inp.attack && this.stam >= CFG.ATTACK_COST) this.startAttack(game, true);
        else if (this.stateT >= CFG.COMBO_OPEN && inp.dodge && this.stam >= CFG.DODGE_COST) this.startDodge(inp, game);
        else if (this.stateT >= this.dur) this.setState('idle');
        break;
      case 'feint':
      case 'dodge':
      case 'stagger':
        if (this.stateT >= this.dur) this.setState('idle');
        break;
    }

    // Движение
    if (this.state === 'dodge') {
      const k = Math.exp(-5 * dt);
      this.vx *= k; this.vz *= k;
    } else if (this.state !== 'bind') {
      const mul = { idle: 1, windup: 0.45, strike: 0.3, recover: 0.6, feint: 0.7, stagger: 0.2 }[this.state] ?? 1;
      let mx = clamp(inp.mx || 0, -1, 1), mz = clamp(inp.mz || 0, -1, 1);
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      const sp = mul * (this.blocking ? 0.6 : 1);
      const fwd = mz * (mz > 0 ? CFG.WALK : CFG.BACK) * sp, side = mx * CFG.STRAFE * sp;
      const f = fwdOf(this.yaw), r = rightOf(this.yaw);
      this.vx = approach(this.vx, f.x * fwd + r.x * side, CFG.ACC * dt);
      this.vz = approach(this.vz, f.z * fwd + r.z * side, CFG.ACC * dt);
    }
    this.integrate(dt);

    const busy = this.state === 'windup' || this.state === 'strike' || this.state === 'dodge' || this.state === 'bind';
    if (this.stamDelay <= 0 && !busy) {
      this.stam = Math.min(CFG.STAM_MAX, this.stam + CFG.STAM_REGEN * (this.blocking ? 0.45 : 1) * dt);
    }
    this.speed = Math.hypot(this.vx, this.vz);
    this.walkPhase += this.speed * dt * 4.2;
  }

  integrate(dt) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const r = Math.hypot(this.x, this.z);
    if (r > CFG.ARENA_R) { this.x *= CFG.ARENA_R / r; this.z *= CFG.ARENA_R / r; }
  }
}
