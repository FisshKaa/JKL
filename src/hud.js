'use strict';
const HUD_FONT = 'Unbounded, "Arial Black", sans-serif';

class HUD {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.c.width = innerWidth * this.dpr;
    this.c.height = innerHeight * this.dpr;
  }

  draw(game, view, player) {
    const ctx = this.ctx, d = this.dpr, W = innerWidth, H = innerHeight;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (game.mode !== 'bot') return;
    const [P, E] = game.fighters;
    const u = clamp(Math.min(W / 1280, H / 720), 0.7, 1.4);

    // Красная виньетка при попадании
    if (game.hurt > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, 'rgba(255,40,40,0)'); g.addColorStop(1, `rgba(200,20,30,${0.45 * game.hurt})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    if (game.state === 'fight' || game.state === 'intro') {
      if (player.lockOn && !E.dead) {
        const s = view.project(E.x, 1.3, E.z);
        if (s.visible) this.drawStar(ctx, s.x, s.y, 66 * u, game, player);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(W / 2, H / 2, 2.5, 0, TAU); ctx.fill();
      }
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

    // Игрок: внизу слева
    const px = 36 * u, py = H - 56 * u, pw = 300 * u;
    ctx.textAlign = 'left';
    ctx.font = `600 ${12 * u}px ${HUD_FONT}`;
    ctx.fillStyle = 'rgba(232,234,255,0.7)';
    ctx.fillText('Здоровье', px, py - 8 * u);
    this.bar(ctx, px, py, pw, 10 * u, P.hp / CFG.HP_MAX, P.color);
    ctx.fillText('Выносливость', px, py + 32 * u);
    this.bar(ctx, px, py + 38 * u, pw * 0.8, 6 * u, P.stam / CFG.STAM_MAX, P.stam < 25 ? '#ff6b6b' : '#f0dca8');
    if (!player.lockOn) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('Захват цели выключен, Q чтобы включить', px, py - 34 * u);
    }

    // Клинч
    if (game.bind) {
      const bd = game.bind, mine = bd.a === P ? bd.m : -bd.m;
      const mw = 420 * u, mx = W / 2 - mw / 2, my = H * 0.72;
      ctx.fillStyle = 'rgba(10,10,28,0.7)';
      ctx.fillRect(mx - 4, my - 4, mw + 8, 22 * u + 8);
      ctx.fillStyle = E.color; ctx.fillRect(mx, my, mw, 22 * u);
      ctx.fillStyle = P.color; ctx.fillRect(mx, my, mw * (0.5 + mine / 2), 22 * u);
      ctx.fillStyle = '#fff'; ctx.fillRect(mx + mw * (0.5 + mine / 2) - 2, my - 6, 4, 22 * u + 12);
      ctx.textAlign = 'center';
      ctx.font = `700 ${16 * u}px ${HUD_FONT}`;
      ctx.fillText('Клинч: жми ЛКМ быстрее соперника', W / 2, my - 16 * u);
      ctx.font = `400 ${12 * u}px ${HUD_FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('Пробел: разорвать клинч за выносливость', W / 2, my + 44 * u);
    }

    // Всплывающие надписи
    ctx.textAlign = 'center';
    game.popups.forEach((p, i) => {
      const a = Math.min(1, (p.dur - p.t) * 3) * Math.min(1, p.t * 10);
      ctx.globalAlpha = a;
      ctx.font = `700 ${22 * u}px ${HUD_FONT}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,6,15,0.8)';
      const y = H * 0.3 - p.t * 30 - i * 30 * u;
      ctx.strokeText(p.text, W / 2, y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, W / 2, y);
    });
    ctx.globalAlpha = 1;

    // Объявления раундов
    const an = game.announcement;
    if (an) {
      const k = an.t / an.dur;
      const alpha = Math.min(1, an.t * 6) * (k > 0.75 ? (1 - k) / 0.25 : 1);
      ctx.save();
      ctx.globalAlpha = alpha;
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
      const cx = x + dir * i * 16 * u;
      ctx.beginPath(); ctx.arc(cx, y, 5 * u, 0, TAU);
      if (i < n) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }

  // Звезда на противнике. Стрелки — стороны экрана: верх, право, низ, лево.
  drawStar(ctx, cx, cy, R, game, player) {
    const [P, E] = game.fighters;
    const vecs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const arm = (i, r0, r1, wid) => {
      const [x, y] = vecs[i], px = -y, py = x;
      ctx.beginPath();
      ctx.moveTo(cx + x * r0 + px * wid, cy + y * r0 + py * wid);
      ctx.lineTo(cx + x * r1, cy + y * r1);
      ctx.lineTo(cx + x * r0 - px * wid, cy + y * r0 - py * wid);
      ctx.closePath();
    };
    const r0 = R * 0.3, wid = R * 0.17;

    // Входящий удар противника: на экране он со стороны mirrorDir
    let threat = -1, prog = 0, perfect = false;
    if (E.state === 'windup' && E.attack) {
      threat = mirrorDir(E.attack.dir);
      prog = clamp(E.stateT / E.dur, 0, 1);
      perfect = E.timeToImpact() <= CFG.PERFECT;
    }
    // Где стоит защита противника: удар с этой стороны экрана попадёт в его блок
    const guard = mirrorDir(E.stance);

    for (let i = 0; i < 4; i++) {
      arm(i, r0, R, wid);
      ctx.fillStyle = 'rgba(10,12,30,0.45)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    // Стойка игрока
    arm(P.stance, r0, R, wid);
    ctx.fillStyle = P.color; ctx.globalAlpha = P.blocking ? 0.95 : 0.6; ctx.fill(); ctx.globalAlpha = 1;
    if (P.blocking) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }

    // Угроза
    if (threat >= 0) {
      const [x, y] = vecs[threat];
      ctx.save();
      arm(threat, r0, R, wid); ctx.clip();
      ctx.fillStyle = perfect ? '#fff4c2' : '#ff3b4e';
      const len = (R - r0) * prog;
      ctx.beginPath();
      ctx.arc(cx + x * R, cy + y * R, len + 2, 0, TAU);
      ctx.fill();
      ctx.restore();
      arm(threat, r0, R * 1.08, wid * 1.15);
      ctx.strokeStyle = perfect ? '#fff4c2' : '#ff3b4e'; ctx.lineWidth = perfect ? 3 : 2; ctx.stroke();
      if (perfect) {
        ctx.shadowColor = '#fff4c2'; ctx.shadowBlur = 18; ctx.stroke(); ctx.shadowBlur = 0;
      }
    }

    // Защита противника: маленький щит на кончике стрелки
    {
      const [x, y] = vecs[guard], tx = cx + x * (R + 12), ty = cy + y * (R + 12);
      ctx.beginPath();
      ctx.moveTo(tx - y * 9 - x * 3, ty + x * 9 - y * 3);
      ctx.lineTo(tx + y * 9 - x * 3, ty - x * 9 - y * 3);
      ctx.strokeStyle = E.blocking ? '#ffffff' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = E.blocking ? 4 : 2;
      ctx.stroke();
    }

    // Контрудар доступен
    if (P.riposteT > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, -Math.PI / 2, -Math.PI / 2 + TAU * (P.riposteT / CFG.RIPOSTE_WINDOW));
      ctx.strokeStyle = P.color; ctx.lineWidth = 3; ctx.stroke();
    }

    // Курсор мыши внутри звезды
    ctx.beginPath();
    ctx.arc(cx + player.vec.x * r0 * 0.9, cy + player.vec.y * r0 * 0.9, 3.5, 0, TAU);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  }
}
