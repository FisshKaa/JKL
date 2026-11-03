'use strict';
const HUD_FONT = 'Unbounded, "Arial Black", sans-serif';
// Экранные направления стрелок креста: верх, право, низ-право, низ-лево, лево
const ARM_VECS = [[0, -1], [1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0]];

class HUD {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.toast = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.c.width = innerWidth * this.dpr;
    this.c.height = innerHeight * this.dpr;
  }

  note(text) { this.toast = { text, t: 0 }; }

  draw(game, view, player, dt) {
    const ctx = this.ctx, d = this.dpr, W = innerWidth, H = innerHeight;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (game.mode !== 'bot') return;
    const [P, E] = game.fighters;
    const u = clamp(Math.min(W / 1280, H / 720), 0.7, 1.4);

    if (game.hurt > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, 'rgba(255,40,40,0)'); g.addColorStop(1, `rgba(200,20,30,${0.45 * game.hurt})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    const fighting = game.state === 'fight' || game.state === 'intro';
    if (fighting && !E.dead && !game.bind) {
      const s = view.project(E.x, E.y + 1.3, E.z);
      if (s.visible) {
        const far = dist2d(P, E) > CFG.REACH + 1.5;
        ctx.globalAlpha = far ? 0.45 : 1;
        this.drawCross(ctx, s.x, s.y, (player.lockOn ? 64 : 54) * u, game, player);
        ctx.globalAlpha = 1;
      } else this.drawOffscreen(ctx, s, W, H, E.color);
    }
    if (fighting && !player.lockOn && !game.bind) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 2.2, 0, TAU); ctx.fill();
    }

    // Противник: имя и здоровье сверху
    const bw = 360 * u, bx = W / 2 - bw / 2, by = 40 * u;
    ctx.textAlign = 'center';
    ctx.font = `600 ${14 * u}px ${HUD_FONT}`;
    ctx.fillStyle = '#e8eaff';
    ctx.fillText(E.name, W / 2, by - 10 * u);
    this.bar(ctx, bx, by, bw, 8 * u, E.hp / CFG.HP_MAX, E.color);
    this.bar(ctx, bx + bw * 0.2, by + 13 * u, bw * 0.6, 4 * u, E.stam / CFG.STAM_MAX, 'rgba(240,220,170,0.8)');
    this.pips(ctx, W / 2 + bw / 2 + 18 * u, by + 4 * u, game.scores[1], E.color, u, 1);
    this.pips(ctx, W / 2 - bw / 2 - 18 * u, by + 4 * u, game.scores[0], P.color, u, -1);

    // Игрок
    const px = 36 * u, py = H - 56 * u, pw = 300 * u;
    ctx.textAlign = 'left';
    ctx.font = `600 ${12 * u}px ${HUD_FONT}`;
    ctx.fillStyle = 'rgba(232,234,255,0.7)';
    ctx.fillText('Здоровье', px, py - 8 * u);
    this.bar(ctx, px, py, pw, 10 * u, P.hp / CFG.HP_MAX, P.color);
    ctx.fillText('Выносливость', px, py + 32 * u);
    this.bar(ctx, px, py + 38 * u, pw * 0.8, 6 * u, P.stam / CFG.STAM_MAX, P.stam < 25 ? '#ff6b6b' : '#f0dca8');
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(player.lockOn ? 'Цель захвачена (Q)' : 'Свободный обзор (Q — захват)', px, py - 34 * u);

    if (game.bind && (game.bind.a === P || game.bind.b === P)) this.drawBind(ctx, game, P, W, H, u);

    // Всплывающие надписи
    ctx.textAlign = 'center';
    game.popups.forEach((p, i) => {
      ctx.globalAlpha = Math.min(1, (p.dur - p.t) * 3) * Math.min(1, p.t * 10);
      ctx.font = `700 ${22 * u}px ${HUD_FONT}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,6,15,0.8)';
      const y = H * 0.28 - p.t * 30 - i * 30 * u;
      ctx.strokeText(p.text, W / 2, y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, W / 2, y);
    });
    ctx.globalAlpha = 1;

    // Подсказка о переключениях
    if (this.toast) {
      this.toast.t += dt;
      const a = Math.min(1, (1.4 - this.toast.t) * 3);
      if (a <= 0) this.toast = null;
      else {
        ctx.globalAlpha = a;
        ctx.font = `600 ${13 * u}px ${HUD_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(this.toast.text, W / 2, H - 40 * u);
        ctx.globalAlpha = 1;
      }
    }

    const an = game.announcement;
    if (an) {
      const k = an.t / an.dur;
      ctx.save();
      ctx.globalAlpha = Math.min(1, an.t * 6) * (k > 0.75 ? (1 - k) / 0.25 : 1);
      ctx.translate(W / 2, H * 0.42);
      const pop = 1 + Math.max(0, 0.18 - an.t) * 2;
      ctx.scale(pop, pop);
      ctx.font = `800 ${60 * u}px ${HUD_FONT}`;
      ctx.shadowColor = an.color; ctx.shadowBlur = 30;
      ctx.fillStyle = '#fff';
      ctx.fillText(an.text, 0, 0);
      ctx.shadowBlur = 0;
      if (an.sub) {
        ctx.font = `600 ${18 * u}px ${HUD_FONT}`;
        ctx.fillStyle = an.color === '#ffffff' ? 'rgba(255,255,255,0.75)' : an.color;
        ctx.fillText(an.sub, 0, 40 * u);
      }
      ctx.restore();
    }
  }

  bar(ctx, x, y, w, h, k, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(k, 0, 1), h);
  }

  pips(ctx, x, y, n, color, u, dir) {
    for (let i = 0; i < CFG.ROUNDS_TO_WIN; i++) {
      ctx.beginPath(); ctx.arc(x + dir * i * 16 * u, y, 5 * u, 0, TAU);
      if (i < n) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }

  // Противник за краем экрана: стрелка у края в его сторону
  drawOffscreen(ctx, s, W, H, color) {
    let dx = s.x - W / 2, dy = s.y - H / 2;
    if (s.behind) { dx = -dx; dy = -dy; }
    const a = Math.atan2(dy, dx), r = Math.min(W, H) * 0.42;
    const x = W / 2 + Math.cos(a) * r, y = H / 2 + Math.sin(a) * r;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath();
    ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill();
    ctx.restore();
  }

  // Крест на противнике
  drawCross(ctx, cx, cy, R, game, player) {
    const [P, E] = game.fighters;
    const arm = (i, r0, r1, wid) => {
      const [x, y] = ARM_VECS[i], px = -y, py = x;
      ctx.beginPath();
      ctx.moveTo(cx + x * r0 + px * wid, cy + y * r0 + py * wid);
      ctx.lineTo(cx + x * r1, cy + y * r1);
      ctx.lineTo(cx + x * r0 - px * wid, cy + y * r0 - py * wid);
      ctx.closePath();
    };
    const r0 = R * 0.3, wid = R * 0.15;

    let threat = -1, prog = 0, perfect = false;
    if (E.state === 'windup' && E.attack) {
      threat = mirrorDir(E.attack.dir);
      prog = clamp(E.stateT / E.dur, 0, 1);
      perfect = E.timeToImpact() <= CFG.PERFECT;
    }
    const guard = mirrorDir(E.stance);

    for (let i = 0; i < NDIR; i++) {
      arm(i, r0, R, wid);
      ctx.fillStyle = 'rgba(10,12,30,0.45)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    arm(P.stance, r0, R, wid);
    const sa = ctx.globalAlpha;
    ctx.fillStyle = P.color; ctx.globalAlpha = sa * (P.blocking ? 0.95 : 0.6); ctx.fill(); ctx.globalAlpha = sa;
    if (P.blocking) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }

    if (threat >= 0) {
      const [x, y] = ARM_VECS[threat];
      ctx.save();
      arm(threat, r0, R, wid); ctx.clip();
      ctx.fillStyle = perfect ? '#fff4c2' : '#ff3b4e';
      ctx.beginPath(); ctx.arc(cx + x * R, cy + y * R, (R - r0) * prog + 2, 0, TAU); ctx.fill();
      ctx.restore();
      arm(threat, r0, R * 1.08, wid * 1.15);
      ctx.strokeStyle = perfect ? '#fff4c2' : '#ff3b4e'; ctx.lineWidth = perfect ? 3 : 2; ctx.stroke();
      if (perfect) { ctx.shadowColor = '#fff4c2'; ctx.shadowBlur = 18; ctx.stroke(); ctx.shadowBlur = 0; }
    }

    // Защита противника: чёрточка у кончика стрелки
    {
      const [x, y] = ARM_VECS[guard], tx = cx + x * (R + 12), ty = cy + y * (R + 12);
      ctx.beginPath();
      ctx.moveTo(tx - y * 9 - x * 3, ty + x * 9 - y * 3);
      ctx.lineTo(tx + y * 9 - x * 3, ty - x * 9 - y * 3);
      ctx.strokeStyle = E.blocking ? '#ffffff' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = E.blocking ? 4 : 2;
      ctx.stroke();
    }

    if (P.riposteT > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, -Math.PI / 2, -Math.PI / 2 + TAU * (P.riposteT / CFG.RIPOSTE_WINDOW));
      ctx.strokeStyle = P.color; ctx.lineWidth = 3; ctx.stroke();
    }

    // Курсор выбора внутри креста
    ctx.beginPath();
    ctx.arc(cx + player.vec.x * r0 * 0.9, cy + player.vec.y * r0 * 0.9, 3.5, 0, TAU);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  }

  // Мини-игра клинча
  drawBind(ctx, game, P, W, H, u) {
    const bd = game.bind, s = game.bindSide(P), opp = bd.a === P ? bd.sb : bd.sa;
    const cx = W / 2, cy = H * 0.6, R = 86 * u;
    const ang = f => f * TAU - Math.PI / 2;
    const frac = Math.min(1, bd.t / s.rev);

    ctx.fillStyle = 'rgba(8,8,22,0.6)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 26 * u, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 10 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

    bd.zones.forEach((z, i) => {
      const hit = s.hits[i], passed = frac > z.c + CFG.BIND_ZONE && !hit;
      ctx.lineWidth = 12 * u;
      ctx.strokeStyle = hit === 3 ? '#ffd23f' : hit === 2 ? '#7dff9a' : passed ? 'rgba(255,70,80,0.55)' : 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(cx, cy, R, ang(z.c - CFG.BIND_ZONE), ang(z.c + CFG.BIND_ZONE)); ctx.stroke();
      if (!hit && !passed) {
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 16 * u;
        ctx.beginPath(); ctx.arc(cx, cy, R, ang(z.c - CFG.BIND_PERFECT), ang(z.c + CFG.BIND_PERFECT)); ctx.stroke();
      }
    });

    // Стрелка
    const a = ang(frac);
    ctx.strokeStyle = P.color; ctx.lineWidth = 4 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.25, cy + Math.sin(a) * R * 0.25); ctx.lineTo(cx + Math.cos(a) * (R + 14 * u), cy + Math.sin(a) * (R + 14 * u)); ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${30 * u}px ${HUD_FONT}`;
    ctx.fillText(String(s.score), cx, cy + 10 * u);
    ctx.font = `600 ${11 * u}px ${HUD_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`соперник ${'●'.repeat(opp.hits.filter(h => h).length)}${'○'.repeat(3 - opp.hits.filter(h => h).length)}`, cx, cy + 30 * u);

    const label = (text, y, font, color) => {
      ctx.font = font;
      const w = ctx.measureText(text).width + 24 * u, h = 26 * u;
      ctx.fillStyle = 'rgba(8,8,22,0.78)';
      ctx.fillRect(cx - w / 2, y - h * 0.68, w, h);
      ctx.fillStyle = color; ctx.fillText(text, cx, y);
    };
    label('Клинч: ЛКМ, когда стрелка в зоне', cy - R - 40 * u, `700 ${16 * u}px ${HUD_FONT}`, '#ffffff');
    label('Центр зоны 3 очка, край 2, мимо −1. Shift — вырваться', cy + R + 46 * u, `400 ${12 * u}px ${HUD_FONT}`, 'rgba(255,255,255,0.75)');

    if (s.flash && bd.t - s.flash.t < 0.5) {
      ctx.font = `700 ${18 * u}px ${HUD_FONT}`;
      ctx.fillStyle = s.flash.good ? '#ffd23f' : '#ff6b6b';
      ctx.fillText(s.flash.text, cx + R + 70 * u, cy);
    }
  }
}
