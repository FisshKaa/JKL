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
    this.style = 'niman';
    this.weapon = 'single';
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, speed: 0, walkPhase: 0,
      onGround: true, ground: null, airJumps: 1, wallJumps: 0,
      forcing: false, forceT: 0, forcePaid: false,
      flip: null, wallT: 9, wallN: { x: 0, z: 0 }, wallBox: null, mantle: null, ledge: null, landT: 9, prepT: 0, pushCd: 0, pushFired: false, kickCd: 0, kickFired: false, disarm: null, rollReq: 0, wallRun: null, wallRunUsed: false, blockFxT: -9, blockFxPerfect: false, hitFxT: -9, hitFxSide: 0, flourishAt: -9, fin: null,
      hp: CFG.HP_MAX, stam: CFG.STAM_MAX, stamDelay: 0,
      stance: DIR.RIGHT, blocking: false, blockStart: -10,
      state: 'idle', stateT: 0, dur: 0, recoverDur: CFG.RECOVER,
      attack: null, attackId: 0, lastDir: -1, comboIdx: 0, riposteT: 0,
      dead: false, deathT: 0, hitFlash: 0, ignite: 0, windupMul: 1,
    });
  }

  get alive() { return !this.dead; }

  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.dur = dur; }

  timeToImpact() { return this.state === 'windup' ? this.dur - this.stateT : Infinity; }

  isInvulnerable() {
    if (this.state === 'roll' && this.stateT >= 0.03 && this.stateT <= 0.3) return true;
    if (this.state === 'dodge') {
      // Окно неуязвимости растёт с длительностью ухода, но медленнее — долгий акробатический уход дольше открыт в конце
      const m = this.dur / CFG.DODGE, a = CFG.IFRAMES[0] * m, b = a + (CFG.IFRAMES[1] - CFG.IFRAMES[0]) * (1 + (m - 1) * 0.4);
      if (this.stateT >= a && this.stateT <= b) return true;
    }
    return !!this.flip && this.flip.t >= CFG.FLIP_IFRAMES[0] && this.flip.t <= CFG.FLIP_IFRAMES[1];
  }

  spend(v) { this.stam = Math.max(0, this.stam - v); this.stamDelay = CFG.STAM_DELAY; }

  stagger(dur) {
    if (this.dead) return;
    this.mantle = null; this.ledge = null;
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

  startAttack(game, combo, forceDir) {
    const dir = forceDir == null ? this.stance : forceDir;
    const S = styleSim(this);
    let w = dir === DIR.THRUST ? CFG.THRUST_WINDUP * S.thrust : CFG.WINDUP * S.windup;
    const riposte = this.riposteT > 0;
    if (riposte) { w = CFG.WINDUP_RIPOSTE; this.riposteT = 0; this.comboIdx = 0; }
    else if (combo) { this.comboIdx++; w = dir === DIR.THRUST ? CFG.THRUST_WINDUP * 0.9 * S.thrust : dir !== this.lastDir ? CFG.WINDUP_COMBO * S.combo : CFG.WINDUP * 0.95 * S.windup; }
    else this.comboIdx = 0;
    w *= this.windupMul;
    this.attack = { dir, windup: w, riposte, combo: this.comboIdx, id: ++this.attackId, swung: false, blocked: false, heavy: false };
    this.lastDir = dir;
    this.blocking = false;
    this.spend(CFG.ATTACK_COST * S.stam);
    this.setState('windup', w);
  }

  startDodge(inp, game) {
    let mx = inp.mx || 0, mz = inp.mz || 0;
    if (!mx && !mz) mz = -1;
    const l = Math.hypot(mx, mz);
    const f = fwdOf(this.yaw), r = rightOf(this.yaw);
    const S = styleSim(this);
    this.vx = (f.x * mz + r.x * mx) / l * CFG.DODGE_SPEED * S.dodgeSpeed;
    this.vz = (f.z * mz + r.z * mx) / l * CFG.DODGE_SPEED * S.dodgeSpeed;
    this.blocking = false;
    this.spend(CFG.DODGE_COST);
    this.setState('dodge', CFG.DODGE * S.dodgeDur);   // у каждой формы свой уход: кувырок и сальто дольше рывка
    game.audio.dash();
  }

  // Выбитый клинок: летит, падает, ждёт; подобрать — подойти, притянуть — R
  updateDisarm(dt, game) {
    const D = this.disarm;
    if (!D) return;
    D.t += dt;
    if (!D.landed && !D.lost) {
      D.vy -= CFG.GRAVITY * dt;
      D.x += D.vx * dt; D.y += D.vy * dt; D.z += D.vz * dt;
      const g = ARENA.groundAt(D.x, D.z, D.y + 0.1);
      if (D.y <= g.y + 0.03) { D.y = g.y + 0.03; D.landed = true; }
      if (D.y < ARENA.fallY) { D.lost = true; D.t = 0; }
    }
    if (D.lost && D.t > CFG.LOST_RETURN) { this.disarm = null; game.audio.ignite(); return; }
    if (D.landed && this.onGround && Math.hypot(this.x - D.x, this.z - D.z) < CFG.PICKUP_DIST && Math.abs(this.y - D.y) < 1) {
      this.disarm = null; game.audio.ignite();
    }
  }

  startFlip(type, game) {
    this.flip = { type, t: 0 };
    this.blocking = false;
    game.audio.flip();
  }

  // Прыжок, сальто, отскок от стены
  tryJump(inp, game) {
    if (this.onGround) {
      if (this.prepT <= 0) this.prepT = CFG.JUMP_PREP;   // короткий присед, толчок — в update
      return;
    }
    this.airJump(inp, game);
  }

  launch(game) {
    {
      this.vy = CFG.JUMP_V * styleSim(this).jump;
      this.onGround = false; this.ground = null;
      this.forcing = true; this.forceT = 0; this.forcePaid = false;
      game.audio.jump();
    }
  }

  airJump(inp, game) {
    const md = this.moveDir(inp);
    if (this.wallT < 0.2 && this.wallJumps < CFG.WALLJUMP_MAX && this.stam >= CFG.FLIP_COST) {
      this.wallRun = null;
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
    if (this.airJumps > 0 && this.stam >= CFG.FLIP_COST * styleSim(this).flip) {
      this.airJumps--;
      this.vy = CFG.FLIP_V;
      const f = fwdOf(this.yaw);
      let type = 'back', px = -f.x, pz = -f.z;
      if (md.len > 0.2) {
        px = md.x / md.len; pz = md.z / md.len;
        type = Math.abs(md.mz) >= Math.abs(md.mx) ? (md.mz > 0 ? 'front' : 'back') : (md.mx > 0 ? 'right' : 'left');
      }
      this.vx += px * CFG.FLIP_PUSH; this.vz += pz * CFG.FLIP_PUSH;
      this.spend(CFG.FLIP_COST * styleSim(this).flip);
      this.startFlip(type, game);
    }
  }

  update(dt, inp, opp, game) {
    this.stateT += dt;
    this.stamDelay = Math.max(0, this.stamDelay - dt);
    this.riposteT = Math.max(0, this.riposteT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.wallT += dt; this.landT += dt; this.pushCd = Math.max(0, this.pushCd - dt); this.kickCd = Math.max(0, this.kickCd - dt); this.rollReq = Math.max(0, this.rollReq - dt);
    if (this.flip) { this.flip.t += dt; if (this.flip.t >= CFG.FLIP_DUR) this.flip = null; }

    if (this.dead) {
      this.deathT += dt;
      this.vx *= 0.9; this.vz *= 0.9;
      this.physics(dt, game, {});
      return;
    }

    const active = game.controlsEnabled;

    if (this.state !== 'bind' && this.state !== 'vault' && this.state !== 'climb' && this.state !== 'hang') {
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

    // Присед перед прыжком
    if (this.prepT > 0) {
      this.prepT -= dt;
      if (this.prepT <= 0) { this.prepT = 0; if (this.onGround && (this.state === 'idle' || this.state === 'recover')) { this.setState('idle'); this.launch(game); } }
    }
    // Клинок гаснет, пока руки заняты уступом
    const handsBusy = this.state === 'hang' || this.state === 'climb' || !!this.disarm;
    this.updateDisarm(dt, game);
    if (handsBusy) { if (this.ignite > 0.9) game.audio.retract(); this.ignite = Math.max(0, this.ignite - dt * 4); }
    else if (this.ignite < 1) { if (this.ignite < 0.05) game.audio.ignite(); this.ignite = Math.min(1, this.ignite + dt * 3); }

    if (this.state === 'hang') { this.updateHang(dt, inp, game); this.physics(dt, game, inp); return; }

    const free = this.state === 'idle' || this.state === 'recover' || this.state === 'dodge' || this.state === 'feint';
    if (free && inp.stance != null && inp.stance >= 0 && inp.stance < NDIR && inp.stance !== this.stance) {
      this.stance = inp.stance;
      if (this.blocking) this.blockStart = game.time; // перевод блока на другую сторону = новый блок
    }
    const wantBlock = !!inp.block && this.state === 'idle' && this.stam > 0 && !this.flip && this.ignite > 0.8;
    if (wantBlock && !this.blocking) this.blockStart = game.time;
    this.blocking = wantBlock;

    switch (this.state) {
      case 'idle':
        if (inp.jump) this.tryJump(inp, game);
        else if (inp.attack && this.stam >= CFG.ATTACK_COST && !this.flip && this.ignite > 0.8 && this.prepT <= 0) {
          this.startAttack(game, false);
          if (!this.onGround) {
            // Удар в прыжке: нырок сверху вниз с рывком вперёд
            const f = fwdOf(this.yaw);
            this.attack.dir = DIR.UP; this.attack.dive = true;
            this.dur = this.attack.windup = CFG.DIVE_WINDUP;
            this.vy = Math.min(this.vy, 0) - CFG.DIVE_V * 0.4;
            this.vx += f.x * CFG.DIVE_FWD; this.vz += f.z * CFG.DIVE_FWD;
            this.forcing = false;
          }
        }
        else if (inp.kick && this.kickCd <= 0 && this.stam >= CFG.KICK_COST * styleSim(this).kick && this.onGround) {
          this.spend(CFG.KICK_COST * styleSim(this).kick); this.kickCd = CFG.KICK_CD; this.kickFired = false; this.blocking = false;
          this.setState('kick', CFG.KICK_TIME);
          const kf = fwdOf(this.yaw); this.vx += kf.x * 2.6; this.vz += kf.z * 2.6;   // выпад вперёд
          game.audio.dash();
        }
        else if (inp.push && this.disarm && !this.disarm.lost) { this.setState('pull', CFG.PULL_TIME); game.audio.pushCharge(); }
        else if (inp.thrust && this.stam >= CFG.ATTACK_COST && !this.flip && this.ignite > 0.8 && this.prepT <= 0) this.startAttack(game, false, DIR.THRUST);
        else if (inp.dodge && this.onGround && this.stam >= CFG.DODGE_COST) this.startDodge(inp, game);
        else if (inp.dodge && !this.onGround) this.rollReq = CFG.ROLL_BUFFER;   // перекат при приземлении
        else if (inp.push && this.pushCd <= 0 && this.stam >= CFG.PUSH_COST * styleSim(this).push && !this.flip && !this.disarm) {
          this.spend(CFG.PUSH_COST * styleSim(this).push); this.pushCd = CFG.PUSH_CD * styleSim(this).pushCd; this.pushFired = false;
          this.blocking = false;
          this.setState('push', CFG.PUSH_TIME);
          game.audio.pushCharge();
        }
        else if (inp.clinch) game.tryClinch(this, opp);
        else if (inp.flourish && this.onGround && !this.blocking && !this.disarm && this.ignite > 0.9) this.flourishAt = game.time;   // покрутить клинок
        break;
      case 'windup':
        // Удержание ЛКМ превращает удар в тяжёлый: дольше замах, сильнее удар, пробивает блок
        if (this.attack.dive && this.stateT > CFG.DIVE_WINDUP * 0.5) this.vy = Math.min(this.vy, -CFG.DIVE_V);
        if (!this.attack.heavy && !this.attack.dive && !this.attack.riposte && this.attack.dir !== DIR.THRUST && inp.attackHeld &&
            this.stateT >= this.dur * 0.55 && this.stam >= CFG.HEAVY_COST) {
          this.attack.heavy = true;
          this.dur += CFG.HEAVY_EXTRA; this.attack.windup = this.dur;
          this.spend(CFG.HEAVY_COST);
        }
        if (!this.attack.swung && this.stateT >= this.dur - CFG.SWEEP_PRE) {
          this.attack.swung = true;
          game.audio.swing(this.attack.riposte || this.attack.heavy);
        }
        if (inp.feint && !this.attack.riposte && this.stateT < this.dur * 0.8 && this.stam >= CFG.FEINT_COST * styleSim(this).feint) {
          this.spend(CFG.FEINT_COST * styleSim(this).feint);
          this.setState('feint', CFG.FEINT);
          game.onFeint(this);
        } else if (this.stateT >= this.dur) game.resolveImpact(this, opp);
        break;
      case 'strike':
        if (this.stateT >= CFG.STRIKE) this.setState('recover', this.attack.dive ? Math.max(this.recoverDur, CFG.DIVE_RECOVER) : this.recoverDur);
        break;
      case 'recover':
        if (this.stateT >= CFG.COMBO_OPEN && inp.jump) { this.setState('idle'); this.tryJump(inp, game); }
        else if (this.stateT >= CFG.COMBO_OPEN && inp.attack && this.stam >= CFG.ATTACK_COST) this.startAttack(game, true);
        else if (this.stateT >= CFG.COMBO_OPEN && inp.thrust && this.stam >= CFG.ATTACK_COST) this.startAttack(game, true, DIR.THRUST);
        else if (this.stateT >= CFG.COMBO_OPEN && inp.dodge && this.onGround && this.stam >= CFG.DODGE_COST) this.startDodge(inp, game);
        else if (this.stateT >= this.dur) this.setState('idle');
        break;
      case 'kick':
        if (!this.kickFired && this.stateT >= CFG.KICK_WINDUP) { this.kickFired = true; game.resolveKick(this, opp); }
        if (this.stateT >= this.dur) this.setState('idle');
        break;
      case 'pull':
        if (this.stateT >= this.dur) { this.disarm = null; this.setState('idle'); game.audio.ignite(); }
        break;
      case 'push':
        if (!this.pushFired && this.stateT >= CFG.PUSH_WINDUP) { this.pushFired = true; game.resolvePush(this, opp); }
        if (this.stateT >= this.dur) this.setState('idle');
        break;
      case 'roll':
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
    if (this.state === 'dodge' || this.state === 'roll') {
      const k = Math.exp(-5 * dt);
      this.vx *= k; this.vz *= k;
    } else if (this.state !== 'bind' && this.state !== 'vault' && this.state !== 'climb') {
      const mul = { idle: 1, windup: 0.45, strike: 0.3, recover: 0.6, feint: 0.7, stagger: 0.2, push: 0.3, kick: 0.2, pull: 0.3 }[this.state] ?? 1;
      const md = this.moveDir(inp);
      const sp = mul * (this.blocking ? 0.6 : 1) * styleSim(this).speed;
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

    const busy = this.state === 'windup' || this.state === 'strike' || this.state === 'dodge' || this.state === 'bind' || this.state === 'vault' || this.state === 'climb';
    if (this.stamDelay <= 0 && !busy) {
      this.stam = Math.min(CFG.STAM_MAX, this.stam + CFG.STAM_REGEN * (this.blocking ? 0.45 * styleSim(this).blockRegen : 1) * dt);
    }
    this.speed = Math.hypot(this.vx, this.vz);
    if (this.onGround || this.wallRun) this.walkPhase += this.speed * dt * 4.2;
  }

  physics(dt, game, inp) {
    const R = CFG.RADIUS, A = ARENA;

    // Перемах и подтягивание: движение по заранее рассчитанной траектории
    if (this.state === 'vault' || this.state === 'climb') {
      const m = this.mantle, k = clamp(this.stateT / this.dur, 0, 1);
      const climb = this.state === 'climb';
      this.y = lerp(m.fy, m.ty, climb ? easeInOut(Math.min(1, k / 0.62)) : easeOut(Math.min(1, k / 0.6)));
      const h = climb ? easeInOut(Math.max(0, (k - 0.45) / 0.55)) : easeInOut(Math.max(0, (k - 0.3) / 0.7));
      this.x = lerp(m.fx, m.tx, h); this.z = lerp(m.fz, m.tz, h);
      this.vx = this.vz = this.vy = 0;
      if (k >= 1) {
        this.mantle = null; this.ledge = null; this.onGround = true; this.ground = m.box;
        this.airJumps = 1; this.wallJumps = 0;
        this.setState('idle');
      }
      return;
    }
    if (this.state === 'hang') { this.vx = this.vz = this.vy = 0; return; }
    if (this.state === 'bind') { this.vy = 0; return; }

    // Бег по стене: скорость вдоль стены, лёгкий прижим к ней, вертикаль задаём сами
    if (this.wallRun) {
      const W = this.wallRun;
      W.t += dt;
      this.vx = W.tx * CFG.WALLRUN_SPEED - W.nx * 0.8;
      this.vz = W.tz * CFG.WALLRUN_SPEED - W.nz * 0.8;
      this.vy = lerp(2.4, -1.6, W.t / CFG.WALLRUN_TIME);
      if (W.t > CFG.WALLRUN_TIME || this.state !== 'idle') this.wallRun = null;
    }

    // По горизонтали: стенка арены и коробки
    this.x += this.vx * dt; this.z += this.vz * dt;
    const rr = Math.hypot(this.x, this.z);
    if (rr > A.radius) { this.x *= A.radius / rr; this.z *= A.radius / rr; }

    let wall = null;
    for (const b of A.boxes) {
      if (b.top <= this.y + 0.02 || (b.bottom || 0) >= this.y + 1.8) continue;
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
    else if (this.wallRun) this.wallRun = null;   // стена кончилась

    // По вертикали
    const prevY = this.y;
    if (this.y < A.fallY - 40) { this.vy = 0; this.vx = this.vz = 0; return; }   // улетел в бездну
    if (!this.wallRun) this.vy -= CFG.GRAVITY * dt * (this.forcing ? CFG.FORCE_GRAV : 1);
    this.y += this.vy * dt;
    const g = A.groundAt(this.x, this.z, prevY + 0.05);
    if (this.y <= g.y) {
      let roll = false;
      if (!this.onGround) {
        this.landT = 0;
        const impact = -this.vy;
        const diving = this.attack && this.attack.dive && (this.state === 'windup' || this.state === 'strike' || this.state === 'recover');
        if (impact > 4 && this.rollReq > 0 && !this.dead && this.state !== 'bind') roll = true;
        else if (impact > CFG.FALL_SAFE && !diving && !this.dead) game.fallDamage(this, impact);
        if (impact > 7) game.audio.land();
        this.wallRun = null; this.wallRunUsed = false;
      }
      this.y = g.y; this.vy = 0;
      this.onGround = true; this.ground = g.box;
      this.airJumps = 1; this.wallJumps = 0; this.forcing = false;
      if (roll) this.startRoll(game);
    } else if (this.y > g.y + 0.001) {
      this.onGround = false;
    }

    // Упёрлись в уступ в полёте и тянемся к нему: низкий — перемахнуть, высокий — зацепиться
    if (wall && !this.onGround && game.controlsEnabled && (this.state === 'idle' || this.state === 'recover') && this.ignite > 0.5) {
      const dh = wall.b.top - this.y;
      const md = this.moveDir(inp);
      const into = -(md.x * wall.nx + md.z * wall.nz);
      if (into > 0.5 && this.vy < 2.5 && !this.wallRun) {
        const b = wall.b;
        const ex = clamp(this.x - wall.nx * CFG.RADIUS, b.x1, b.x2), ez = clamp(this.z - wall.nz * CFG.RADIUS, b.z1, b.z2);
        this.ledge = { b, ex, ez, top: b.top, nx: wall.nx, nz: wall.nz };
        this.flip = null; this.forcing = false; this.blocking = false; this.wallRun = null;
        // Если до земли под нами близко, повиснуть нельзя (ноги ушли бы в пол) — перемахиваем
        const below = ARENA.groundAt(this.x, this.z, this.y + 0.05).y;
        const lowLedge = b.top - CFG.HANG_DROP < below + 0.15;
        if (dh > 0.15 && (dh <= CFG.VAULT_REACH || (lowLedge && dh <= CFG.HANG_REACH))) {
          this.startMantle('vault', CFG.VAULT_TIME, game);
        } else if (dh > CFG.VAULT_REACH && dh <= CFG.HANG_REACH) {
          this.x = ex + wall.nx * 0.3; this.z = ez + wall.nz * 0.3;
          this.y = b.top - CFG.HANG_DROP;
          this.vx = this.vy = this.vz = 0;
          this.yaw = Math.atan2(wall.nx, wall.nz);
          this.setState('hang');
          game.audio.land();
        } else this.ledge = null;
      }
    }
    if (wall && !this.onGround && game.controlsEnabled) this.tryWallRun(wall, inp);
  }

  // Начать бег по стене: на бегу вдоль высокой стены, держим направление вдоль неё
  tryWallRun(wall, inp) {
    if (this.wallRun || this.wallRunUsed || this.onGround || this.state !== 'idle' || this.flip) return;
    const tx = -wall.nz, tz = wall.nx;
    const along = this.vx * tx + this.vz * tz;
    const md = this.moveDir(inp), mAlong = md.x * tx + md.z * tz;
    if (Math.abs(along) > CFG.WALLRUN_MIN && Math.abs(mAlong) > 0.4 && sign(mAlong) === sign(along) && this.vy > -2.5 && wall.b.top - this.y > 1.7) {
      const s = sign(along);
      this.wallRun = { t: 0, nx: wall.nx, nz: wall.nz, tx: tx * s, tz: tz * s };
      this.wallRunUsed = true;
    }
  }

  startRoll(game) {
    let dx = this.vx, dz = this.vz, l = Math.hypot(dx, dz);
    if (l < 0.5) { const f = fwdOf(this.yaw); dx = f.x; dz = f.z; l = 1; }
    this.vx = dx / l * CFG.ROLL_SPEED; this.vz = dz / l * CFG.ROLL_SPEED;
    this.rollReq = 0; this.flip = null; this.blocking = false;
    this.setState('roll', CFG.ROLL_TIME);
    game.audio.dash();
  }

  startMantle(kind, dur, game) {
    const L = this.ledge, b = L.b;
    const tx = clamp(L.ex - L.nx * 0.42, b.x1 + 0.2, b.x2 - 0.2);
    const tz = clamp(L.ez - L.nz * 0.42, b.z1 + 0.2, b.z2 - 0.2);
    this.mantle = { fx: this.x, fy: this.y, fz: this.z, tx, ty: L.top, tz, box: b };
    this.yaw = Math.atan2(L.nx, L.nz);
    this.setState(kind, dur);
    game.audio.jump();
  }

  // Вис на краю: W — подтянуться, пробел — сальто от стены, S — отпустить, A/D — перехват вдоль края
  updateHang(dt, inp, game) {
    const L = this.ledge;
    this.stam = Math.max(0, this.stam - CFG.HANG_DRAIN * dt);
    this.stamDelay = CFG.STAM_DELAY;
    const mz = inp.mz || 0, mx = inp.mx || 0;
    if (inp.jump) {
      if (mz > 0.3) { this.startMantle('climb', CFG.CLIMB_TIME, game); return; }
      // Толчок от стены с сальто назад или вбок
      const tx = -L.nz, tz = L.nx;
      this.ledge = null;
      this.setState('idle');
      this.vy = CFG.WALLJUMP_V * 0.95;
      this.vx = L.nx * 4.2 + tx * mx * 2.5; this.vz = L.nz * 4.2 + tz * mx * 2.5;
      this.wallJumps = 1; this.airJumps = 1;
      this.spend(CFG.FLIP_COST);
      this.startFlip(mx > 0.5 ? 'right' : mx < -0.5 ? 'left' : 'back', game);
      return;
    }
    if ((mz > 0.5 && this.stateT > 0.2)) { this.startMantle('climb', CFG.CLIMB_TIME, game); return; }
    if (mz < -0.5 || this.stam <= 0) { this.ledge = null; this.setState('idle'); this.vy = -0.5; this.x += L.nx * 0.08; this.z += L.nz * 0.08; return; }
    if (Math.abs(mx) > 0.2) {
      // Перехват вдоль края
      const tx = -L.nz, tz = L.nx, b = L.b;
      L.ex = clamp(L.ex + tx * mx * CFG.SHIMMY * dt, b.x1, b.x2);
      L.ez = clamp(L.ez + tz * mx * CFG.SHIMMY * dt, b.z1, b.z2);
      this.x = L.ex + L.nx * 0.3; this.z = L.ez + L.nz * 0.3;
    }
  }
}
