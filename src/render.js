'use strict';
const FONT_DISPLAY = 'Unbounded, "Arial Black", sans-serif';

function ikJoint(a, b, l1, l2, prefer) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.max(0.001, Math.min(Math.hypot(dx, dy), l1 + l2 - 0.001));
  const base = Math.atan2(dy, dx);
  const off = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const j1 = { x: a.x + Math.cos(base + off) * l1, y: a.y + Math.sin(base + off) * l1 };
  const j2 = { x: a.x + Math.cos(base - off) * l1, y: a.y + Math.sin(base - off) * l1 };
  return prefer(j1) >= prefer(j2) ? j1 : j2;
}

// ---------- Фон: ночное небо, газовый гигант, силуэты шпилей ----------
class Background {
  constructor() {
    this.stars = Array.from({ length: 220 }, () => ({
      x: Math.random(), y: Math.random() * 0.7, r: Math.random() * 1.3 + 0.3, tw: rand(0, TAU), s: rand(0.5, 2.5),
    }));
    this.far = this.skyline(0.08, 0.24, 1);
    this.near = this.skyline(0.12, 0.36, 1.9);
  }

  skyline(minH, maxH, wMul) {
    const arr = [];
    let x = -0.25;
    while (x < 1.35) {
      const w = rand(0.012, 0.04) * wMul;
      arr.push({
        x, w, h: rand(minH, maxH), spire: Math.random() < 0.35,
        lights: Array.from({ length: (Math.random() * 6) | 0 }, () => ({ fx: Math.random(), fy: Math.random() * 0.8 })),
      });
      x += w + rand(0, 0.018);
    }
    return arr;
  }

  draw(ctx, W, H, cam, base, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04050f');
    g.addColorStop(0.45, '#0e0b26');
    g.addColorStop(0.68, '#2a1236');
    g.addColorStop(0.8, '#120a1e');
    g.addColorStop(1, '#03040a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const px = (cam.x - 800) * base, py = (cam.y - 470) * base;

    for (const s of this.stars) {
      const x = ((s.x * W - px * 0.02) % W + W) % W;
      const y = s.y * H - py * 0.02;
      const a = 0.25 + 0.75 * Math.pow(Math.sin(t * s.s + s.tw) * 0.5 + 0.5, 2);
      ctx.fillStyle = `rgba(220,225,255,${a})`;
      ctx.fillRect(x, y, s.r * base * 1.4, s.r * base * 1.4);
    }

    // Газовый гигант с кольцом
    const R = H * 0.2, cx = W * 0.76 - px * 0.04, cy = H * 0.26 - py * 0.04;
    const pg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
    pg.addColorStop(0, '#f7b98a');
    pg.addColorStop(0.45, '#b4566a');
    pg.addColorStop(1, '#2a0f30');
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#ffd0a8';
    ctx.lineWidth = 2 * base;
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.7, R * 0.28, -0.25, 0, TAU); ctx.stroke();
    ctx.restore();

    // Тёплая дымка у горизонта
    const hy = H * 0.66 - py * 0.12;
    const hz = ctx.createLinearGradient(0, hy - H * 0.25, 0, hy + H * 0.05);
    hz.addColorStop(0, 'rgba(255,120,90,0)');
    hz.addColorStop(1, 'rgba(255,120,90,0.18)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, hy - H * 0.25, W, H * 0.3);

    this.drawSkyline(ctx, this.far, W, H, hy, px * 0.12, '#140f2c', 'rgba(255,190,120,0.55)', t);
    this.drawSkyline(ctx, this.near, W, H, H * 0.76 - py * 0.25, px * 0.25, '#08060f', 'rgba(255,150,100,0.4)', t);

    // Туман бездны
    const fg = ctx.createLinearGradient(0, H * 0.7, 0, H);
    fg.addColorStop(0, 'rgba(40,20,60,0)');
    fg.addColorStop(1, 'rgba(70,40,110,0.45)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);
  }

  drawSkyline(ctx, arr, W, H, baseY, off, fill, light, t) {
    ctx.fillStyle = fill;
    const SW = W * 1.1;
    for (const b of arr) {
      const x = b.x * SW - off, w = b.w * SW, h = b.h * H;
      ctx.fillRect(x, baseY - h, w, h + H);
      if (b.spire) {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.3, baseY - h);
        ctx.lineTo(x + w * 0.5, baseY - h - h * 0.35);
        ctx.lineTo(x + w * 0.7, baseY - h);
        ctx.fill();
      }
    }
    ctx.fillStyle = light;
    for (const b of arr) {
      const x = b.x * SW - off, w = b.w * SW, h = b.h * H;
      for (const l of b.lights) ctx.fillRect(x + l.fx * w, baseY - h + l.fy * h, 2, 2);
    }
  }
}

// ---------- Основной рендер ----------
class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = new Background();
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.round(innerWidth * this.dpr);
    this.c.height = Math.round(innerHeight * this.dpr);
    this.base = Math.min(this.c.width / CFG.WORLD_W, this.c.height / CFG.WORLD_H);
  }

  screenToWorld(cssX, cssY) {
    const x = cssX * this.dpr, y = cssY * this.dpr;
    return { x: (x - this.view.ox) / this.view.scale, y: (y - this.view.oy) / this.view.scale };
  }

  draw(game) {
    const ctx = this.ctx, W = this.c.width, H = this.c.height, cam = game.cam, t = game.time;
    const scale = this.base * cam.zoom;
    const sh = cam.shake * cam.shake * 26 * this.base;
    this.view.scale = scale;
    this.view.ox = W / 2 - cam.x * scale + rand(-sh, sh);
    this.view.oy = H / 2 - cam.y * scale + rand(-sh, sh);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bg.draw(ctx, W, H, cam, this.base, t);

    ctx.setTransform(scale, 0, 0, scale, this.view.ox, this.view.oy);
    this.drawPlatforms(ctx, game.arena, t);
    this.drawBladeLight(ctx, game);
    this.drawGhosts(ctx, game.fx);
    for (const f of game.fighters) this.drawFighter(ctx, f, t);
    for (const f of game.fighters) this.drawBlade(ctx, f, t);
    this.drawEffects(ctx, game.fx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHUD(ctx, game, W, H);
    if (game.mode === 'bot' && !game.paused && game.state !== 'matchEnd' && game.pointer) this.drawCursor(ctx, game);
  }

  drawPlatforms(ctx, arena, t) {
    for (const p of arena.platforms) {
      const w = p.x2 - p.x1;
      if (p.main) {
        // Нижняя конструкция
        const ug = ctx.createLinearGradient(0, p.y, 0, p.y + 230);
        ug.addColorStop(0, '#1c1f33'); ug.addColorStop(1, '#07080f');
        ctx.fillStyle = ug;
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y + 30);
        ctx.lineTo(p.x2, p.y + 30);
        ctx.lineTo(p.x2 - 140, p.y + 120);
        ctx.lineTo(p.x1 + w / 2 + 70, p.y + 230);
        ctx.lineTo(p.x1 + w / 2 - 70, p.y + 230);
        ctx.lineTo(p.x1 + 140, p.y + 120);
        ctx.closePath();
        ctx.fill();
        // Сияние ядра снизу
        const cx = p.x1 + w / 2, cy = p.y + 235;
        const pulse = 0.7 + Math.sin(t * 2) * 0.15;
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 180);
        cg.addColorStop(0, `rgba(150,120,255,${0.55 * pulse})`);
        cg.addColorStop(1, 'rgba(150,120,255,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, 180, 0, TAU); ctx.fill();
        ctx.restore();
        // Плита
        const sg = ctx.createLinearGradient(0, p.y, 0, p.y + 30);
        sg.addColorStop(0, '#363a58'); sg.addColorStop(1, '#14162a');
        ctx.fillStyle = sg;
        ctx.fillRect(p.x1, p.y, w, 30);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let x = p.x1 + 60; x < p.x2; x += 60) { ctx.beginPath(); ctx.moveTo(x, p.y + 4); ctx.lineTo(x, p.y + 30); ctx.stroke(); }
        // Краевые огни
        for (const ex of [p.x1 + 8, p.x2 - 8]) {
          const a = 0.6 + Math.sin(t * 4 + ex) * 0.4;
          ctx.fillStyle = `rgba(255,90,90,${a})`;
          ctx.beginPath(); ctx.arc(ex, p.y + 15, 3.5, 0, TAU); ctx.fill();
        }
      } else {
        ctx.fillStyle = '#23263d';
        ctx.fillRect(p.x1, p.y, w, 14);
        ctx.fillStyle = '#10121f';
        ctx.beginPath(); ctx.moveTo(p.x1 + 10, p.y + 14); ctx.lineTo(p.x2 - 10, p.y + 14); ctx.lineTo(p.x2 - 50, p.y + 40); ctx.lineTo(p.x1 + 50, p.y + 40); ctx.fill();
        const cx = p.x1 + w / 2;
        const gg = ctx.createRadialGradient(cx, p.y + 44, 0, cx, p.y + 44, 70);
        gg.addColorStop(0, 'rgba(150,120,255,0.4)'); gg.addColorStop(1, 'rgba(150,120,255,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(cx, p.y + 44, 70, 0, TAU); ctx.fill();
        ctx.restore();
      }
      // Светящаяся кромка
      ctx.fillStyle = 'rgba(200,215,255,0.55)';
      ctx.fillRect(p.x1, p.y, w, 2);
    }
  }

  // Отсвет клинков на полу
  drawBladeLight(ctx, game) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of game.fighters) {
      if (f.ignite < 0.05) continue;
      const b = f.blade();
      const mx = (b.base.x + b.tip.x) / 2, my = (b.base.y + b.tip.y) / 2;
      for (const p of game.arena.platforms) {
        if (mx < p.x1 - 120 || mx > p.x2 + 120) continue;
        const dy = p.y - my;
        if (dy < -20 || dy > 260) continue;
        const a = 0.28 * (1 - dy / 260) * f.ignite;
        const g = ctx.createRadialGradient(mx, p.y, 0, mx, p.y, 170);
        g.addColorStop(0, rgba(f.rgb, a)); g.addColorStop(1, rgba(f.rgb, 0));
        ctx.fillStyle = g;
        ctx.fillRect(Math.max(p.x1, mx - 170), p.y, Math.min(p.x2, mx + 170) - Math.max(p.x1, mx - 170), p.main ? 30 : 14);
      }
    }
    ctx.restore();
  }

  limb(ctx, a, j, b, fill, rim, w) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(j.x, j.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = rim; ctx.lineWidth = w + 2.4; ctx.stroke();
    ctx.strokeStyle = fill; ctx.lineWidth = w; ctx.stroke();
  }

  drawFighter(ctx, f, t) {
    if (f.out && f.y > CFG.FALL_Y + 200) return;
    const fc = f.facing, x = f.x, y = f.y, l = f.lean;
    const rim = rgba(f.rgb, 0.5);
    const body = f.flash > 0 ? '#eef0ff' : f.stagger > 0.25 ? '#221a36' : '#0c0e19';
    ctx.save();
    if (f.dead) {
      const k = Math.min(1, f.deathT * 3.2);
      ctx.translate(x, y); ctx.rotate(-fc * k * 1.45); ctx.translate(-x, -y);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Ноги
    const hip = { x, y: y - 30 };
    const mv = Math.min(1, Math.abs(f.vx) / CFG.RUN_SPEED);
    let fA, fB;
    if (f.onGround || f.dead) {
      const s = Math.sin(f.walkPhase), c = Math.cos(f.walkPhase);
      fA = { x: x + fc * 9 * (1 - mv) + s * 16 * mv, y: y - Math.max(0, c) * 7 * mv };
      fB = { x: x - fc * 8 * (1 - mv) - s * 16 * mv, y: y - Math.max(0, -c) * 7 * mv };
    } else {
      fA = { x: x + fc * 12, y: y - 10 };
      fB = { x: x - fc * 6, y: y - 16 };
    }
    const knee = foot => ikJoint(hip, foot, 16, 16, j => j.x * fc);
    this.limb(ctx, hip, knee(fB), fB, body, rim, 7);

    // Торс и плащ
    const neck = { x: x + l, y: y - 72 };
    const sway = clamp(-f.vx * 0.02, -10, 10) + Math.sin(t * 3 + f.index) * 1.5;
    ctx.beginPath();
    ctx.moveTo(neck.x - 10, neck.y + 1);
    ctx.lineTo(neck.x + 10, neck.y + 1);
    ctx.lineTo(x + 14, y - 28);
    ctx.lineTo(x + 16 + sway, y - 11);
    ctx.lineTo(x - 16 + sway * 1.4, y - 9);
    ctx.lineTo(x - 14, y - 28);
    ctx.closePath();
    ctx.strokeStyle = rim; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.fillStyle = body; ctx.fill();

    this.limb(ctx, hip, knee(fA), fA, body, rim, 7.5);

    // Руки к рукояти
    const b = f.blade(), sh = f.shoulder;
    const elbow = s => ikJoint(s, b.hand, 14, 14, j => j.y);
    const shB = { x: sh.x - fc * 4, y: sh.y + 1 }, shF = { x: sh.x + fc * 3, y: sh.y };
    this.limb(ctx, shB, elbow(shB), b.hand, body, rim, 5.5);

    // Голова с капюшоном и визором
    const hx = x + l, hy = y - 85;
    ctx.beginPath();
    ctx.moveTo(hx - fc * 8, hy - 7);
    ctx.quadraticCurveTo(hx - fc * 19, hy + 2, hx - fc * 9, hy + 11);
    ctx.lineTo(hx, hy + 6);
    ctx.closePath();
    ctx.fillStyle = body; ctx.fill();
    ctx.beginPath(); ctx.arc(hx, hy, 11, 0, TAU);
    ctx.strokeStyle = rim; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = rgba(f.rgb, f.dead ? 0.2 : 0.95);
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(hx + fc * 3, hy - 1); ctx.lineTo(hx + fc * 9.5, hy - 1.5); ctx.stroke();

    this.limb(ctx, shF, elbow(shF), b.hand, body, rim, 6);

    // Рукоять
    ctx.strokeStyle = '#2c3044'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(b.hand.x - b.c * 5, b.hand.y - b.n * 5); ctx.lineTo(b.base.x, b.base.y); ctx.stroke();
    ctx.strokeStyle = '#a6acc4'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(b.hand.x - b.c * 4, b.hand.y - b.n * 4); ctx.lineTo(b.base.x - b.c * 2, b.base.y - b.n * 2); ctx.stroke();

    // Сгусток импульса
    if (f.pushWindup > 0) {
      const k = 1 - f.pushWindup / CFG.PUSH_WINDUP;
      const ox = sh.x + fc * 22, oy = sh.y + 6, r = 8 + k * 18;
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, 'rgba(230,240,255,0.9)'); g.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  seg(ctx, a, b, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  drawBlade(ctx, f, t) {
    if (f.ignite <= 0.02) return;
    const b = f.blade(), rgb = f.rgb;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';

    // Шлейф взмаха
    const tr = f.trail, n = tr.length;
    for (let i = 1; i < n; i++) {
      const p0 = tr[i - 1], p1 = tr[i];
      const spread = Math.hypot(p1.tx - p0.tx, p1.ty - p0.ty);
      if (spread < 3) continue;
      ctx.fillStyle = rgba(rgb, (i / n) * Math.min(1, spread / 40) * 0.3);
      ctx.beginPath();
      ctx.moveTo(p0.bx, p0.by); ctx.lineTo(p0.tx, p0.ty); ctx.lineTo(p1.tx, p1.ty); ctx.lineTo(p1.bx, p1.by);
      ctx.closePath(); ctx.fill();
    }

    const mx = (b.base.x + b.tip.x) / 2, my = (b.base.y + b.tip.y) / 2;
    const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 110);
    halo.addColorStop(0, rgba(rgb, 0.2 * f.ignite)); halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 110, 0, TAU); ctx.fill();

    const fl = 1 + Math.sin(t * 95 + f.index * 3) * 0.06 + (f.power ? 0.3 : 0);
    this.seg(ctx, b.base, b.tip, 20 * fl, rgba(rgb, 0.15));
    this.seg(ctx, b.base, b.tip, 11 * fl, rgba(rgb, 0.45));
    this.seg(ctx, b.base, b.tip, 6 * fl, rgba(rgb, 0.85));
    ctx.globalCompositeOperation = 'source-over';
    this.seg(ctx, b.base, b.tip, 3.2, 'rgba(255,255,255,0.97)');
    ctx.restore();
  }

  drawGhosts(ctx, fx) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const g of fx.ghosts) {
      const a = (g.life / g.max) * 0.35;
      ctx.strokeStyle = rgba(g.rgb, a);
      ctx.lineWidth = 22;
      ctx.beginPath(); ctx.moveTo(g.x, g.y - 8); ctx.lineTo(g.x + g.lean, g.y - 74); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.x + g.lean, g.y - 85, 11, 0, TAU); ctx.fillStyle = rgba(g.rgb, a); ctx.fill();
    }
    ctx.restore();
  }

  drawEffects(ctx, fx) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of fx.parts) {
      const a = Math.max(0, p.life / p.max);
      if (p.type === 'smoke' || p.type === 'dust') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = p.type === 'smoke' ? `rgba(60,55,70,${a * 0.4})` : `rgba(170,175,210,${a * 0.25})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, TAU); ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        if (p.type === 'ember') {
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        } else {
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const r of fx.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = rgba(r.rgb, (1 - k) * 0.8);
      ctx.lineWidth = r.width * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r0, r.r1, 1 - Math.pow(1 - k, 3)), 0, TAU); ctx.stroke();
    }
    for (const fl of fx.flashes) {
      const a = fl.life / fl.max;
      const g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, fl.r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    for (const tx of fx.texts) {
      const a = Math.min(1, (tx.life / tx.max) * 2);
      ctx.globalAlpha = a;
      ctx.font = `700 ${tx.size}px ${FONT_DISPLAY}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,6,15,0.85)';
      ctx.strokeText(tx.str, tx.x, tx.y);
      ctx.fillStyle = tx.color; ctx.fillText(tx.str, tx.x, tx.y);
    }
    ctx.restore();
  }

  para(ctx, x, y, w, h, sk) {
    ctx.beginPath();
    ctx.moveTo(x + sk, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - sk, y + h); ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  drawHUD(ctx, game, W, H) {
    if (game.mode !== 'bot') return;
    const u = Math.min(W / 1600, H / 900) * 1.05;
    const barW = Math.min(W * 0.36, 480 * u), barH = 16 * u, top = 46 * u, side = 40 * u, sk = 10 * u;

    game.fighters.forEach((f, i) => {
      const right = i === 1;
      const x0 = right ? W - side - barW : side;
      ctx.font = `600 ${15 * u}px ${FONT_DISPLAY}`;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillStyle = '#e8eaff';
      ctx.fillText(f.name, right ? x0 + barW : x0, top - 10 * u);

      this.para(ctx, x0, top, barW, barH, sk);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();

      const span = k => (right ? [x0 + barW * (1 - k), barW * k] : [x0, barW * k]);
      ctx.save();
      this.para(ctx, x0, top, barW, barH, sk); ctx.clip();
      let [gx, gw] = span(f.hpGhost / CFG.HP_MAX);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(gx, top, gw, barH);
      [gx, gw] = span(Math.max(0, f.hp) / CFG.HP_MAX);
      const hg = ctx.createLinearGradient(0, top, 0, top + barH);
      hg.addColorStop(0, rgba(f.rgb, 1)); hg.addColorStop(1, rgba(f.rgb, 0.6));
      ctx.fillStyle = hg; ctx.fillRect(gx, top, gw, barH);
      ctx.restore();

      // Фокус: четыре сегмента
      const fy = top + barH + 7 * u, fh = 6 * u, seg = 4, gap = 4 * u;
      const sw = (barW * 0.6 - gap * (seg - 1)) / seg;
      const fk = f.focus / CFG.FOCUS_MAX;
      for (let s = 0; s < seg; s++) {
        const k = clamp(fk * seg - s, 0, 1);
        const sx = right ? x0 + barW - (s + 1) * sw - s * gap : x0 + s * (sw + gap);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(sx, fy, sw, fh);
        ctx.fillStyle = fk < 0.25 ? '#ff6b6b' : '#d6deff';
        ctx.fillRect(right ? sx + sw * (1 - k) : sx, fy, sw * k, fh);
      }

      // Выигранные раунды
      for (let r = 0; r < CFG.ROUNDS_TO_WIN; r++) {
        const cx = right ? x0 + barW - 6 * u - r * 20 * u : x0 + 6 * u + r * 20 * u;
        const cy = fy + fh + 16 * u;
        ctx.beginPath(); ctx.arc(cx, cy, 5 * u, 0, TAU);
        if (r < game.scores[i]) { ctx.fillStyle = f.color; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5 * u; ctx.stroke(); }
      }
    });

    ctx.textAlign = 'center';
    ctx.font = `400 ${13 * u}px ${FONT_DISPLAY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`Раунд ${game.round}`, W / 2, top + 6 * u);

    const a = game.announcement;
    if (a) {
      const k = a.t / a.dur;
      const alpha = Math.min(1, a.t * 6) * (k > 0.75 ? (1 - k) / 0.25 : 1);
      const pop = 1 + Math.max(0, 0.18 - a.t) * 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(W / 2, H * 0.36);
      ctx.scale(pop, pop);
      ctx.font = `800 ${64 * u}px ${FONT_DISPLAY}`;
      ctx.shadowColor = a.color; ctx.shadowBlur = 30 * u;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(a.text, 0, 0);
      ctx.shadowBlur = 0;
      if (a.sub) {
        ctx.font = `600 ${18 * u}px ${FONT_DISPLAY}`;
        ctx.fillStyle = a.color === '#ffffff' ? 'rgba(255,255,255,0.7)' : a.color;
        ctx.fillText(a.sub, 0, 40 * u);
      }
      ctx.restore();
    }
  }

  drawCursor(ctx, game) {
    const p = game.pointer, x = p.x * this.dpr, y = p.y * this.dpr, d = this.dpr;
    const col = game.fighters[0].color;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5 * d;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(x, y, 9 * d, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 2 * d, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
