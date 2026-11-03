'use strict';
(() => {
  const canvas = document.getElementById('game');
  const hudCanvas = document.getElementById('hud');
  const $ = s => document.querySelector(s);

  const audio = new AudioFX();
  const game = new Game(null, audio);
  const view = new View(canvas, game);
  game.fx = view.fx;
  const hud = new HUD(hudCanvas);
  const player = new PlayerController(canvas);
  player.onStance = () => audio.tick();

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lumen3d:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lumen3d:' + k, v); } catch (e) { /* без сохранения */ } },
  };
  let playerColor = store.get('color', CFG.BLADE_COLORS[0]);
  if (!CFG.BLADE_COLORS.includes(playerColor)) playerColor = CFG.BLADE_COLORS[0];
  let lastLevel = 'normal';

  const rivalColor = c => (c === '#ff4058' ? '#3fb8ff' : '#ff4058');
  const open = id => $(id).classList.add('visible');
  const close = id => $(id).classList.remove('visible');
  const playing = () => game.mode === 'bot' && !game.paused && game.state !== 'matchEnd';

  function lockPointer() {
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* не критично */ }
  }

  function applyColors() {
    document.documentElement.style.setProperty('--accent', playerColor);
    document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-checked', String(s.dataset.color === playerColor)));
    view.setColors();
  }

  function startDemo() {
    const [a, b] = game.fighters;
    a.name = 'Демо'; a.color = playerColor;
    b.name = 'Демо'; b.color = rivalColor(playerColor);
    view.setColors();
    game.startMatch('demo', [new BotController('hard'), new BotController('normal')]);
    document.body.classList.remove('playing');
  }

  function startVsBot(level) {
    lastLevel = level;
    const [a, b] = game.fighters;
    a.name = 'Ты'; a.color = playerColor;
    b.name = BOT_LEVELS[level].title; b.color = rivalColor(playerColor);
    view.setColors();
    player.reset(); player.lockOn = true;
    game.startMatch('bot', [player, new BotController(level)]);
    ['#menu', '#pause', '#result', '#controls'].forEach(close);
    document.body.classList.add('playing');
    if (document.activeElement) document.activeElement.blur();
    lockPointer();
    const t = $('#toast');
    t.classList.add('show');
    clearTimeout(startVsBot.tt);
    startVsBot.tt = setTimeout(() => t.classList.remove('show'), 7000);
  }

  function setPaused(p) {
    if (game.mode !== 'bot' || game.state === 'matchEnd') return;
    game.paused = p;
    if (p) { open('#pause'); document.body.classList.remove('playing'); if (document.pointerLockElement) document.exitPointerLock(); }
    else { close('#pause'); document.body.classList.add('playing'); player.reset(); lockPointer(); }
  }

  function toMenu() {
    ['#pause', '#result'].forEach(close);
    $('#difficulty').classList.add('hidden');
    $('#main-actions').classList.remove('hidden');
    open('#menu');
    if (document.pointerLockElement) document.exitPointerLock();
    startDemo();
  }

  game.onMatchEnd = w => {
    if (game.mode === 'demo') { startDemo(); return; }
    $('#result-title').textContent = w === 0 ? 'Победа' : 'Поражение';
    $('#result-score').textContent = `${game.scores[0]} : ${game.scores[1]}`;
    document.body.classList.remove('playing');
    if (document.pointerLockElement) document.exitPointerLock();
    open('#result');
  };

  // Выход из захвата мыши во время боя = пауза
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && playing()) setPaused(true);
  });
  canvas.addEventListener('click', () => { if (playing() && !document.pointerLockElement) lockPointer(); });

  // Цвет клинка
  const sw = $('#swatches');
  CFG.BLADE_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.dataset.color = c;
    b.style.background = c; b.style.color = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Цвет ${c}`);
    b.addEventListener('click', () => {
      playerColor = c; store.set('color', c);
      if (game.mode === 'demo') { game.fighters[0].color = c; game.fighters[1].color = rivalColor(c); }
      applyColors();
    });
    sw.appendChild(b);
  });
  applyColors();

  document.addEventListener('click', e => {
    const lvl = e.target.closest('[data-level]');
    if (lvl) { audio.ui(); startVsBot(lvl.dataset.level); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    audio.ui();
    switch (a.dataset.action) {
      case 'vsbot': $('#main-actions').classList.add('hidden'); $('#difficulty').classList.remove('hidden'); break;
      case 'back': $('#difficulty').classList.add('hidden'); $('#main-actions').classList.remove('hidden'); break;
      case 'controls': open('#controls'); break;
      case 'close': close('#controls'); break;
      case 'resume': setPaused(false); break;
      case 'restart': game.paused = false; startVsBot(lastLevel); break;
      case 'rematch': startVsBot(lastLevel); break;
      case 'tomenu': game.paused = false; toMenu(); break;
    }
  });

  addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if ($('#controls').classList.contains('visible')) { close('#controls'); return; }
      if (game.paused) setPaused(false);
    }
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
  });
  addEventListener('pointerdown', () => audio.init());
  addEventListener('keydown', () => audio.init());
  addEventListener('blur', () => { if (playing()) setPaused(true); });

  // Главный цикл
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    game.advance(dt);
    view.render(dt, player);
    hud.draw(game, view, player);
    if (audio.ctx) {
      const [P, E] = game.fighters, sp = view.bladeSpeeds();
      const vol = game.paused ? 0 : game.mode === 'demo' ? 0.3 : 1;
      const r = rightOf(P.yaw), dx = E.x - P.x, dz = E.z - P.z, l = Math.hypot(dx, dz) || 1;
      audio.setHum(0, sp[0], P.ignite, 0, vol * (game.mode === 'bot' ? 0.8 : 1));
      audio.setHum(1, sp[1], E.ignite, game.mode === 'bot' ? (dx * r.x + dz * r.z) / l : 0.3, vol * clamp(3 / l, 0.3, 1));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  startDemo();
  // Для отладки из консоли браузера: LUMEN.game.fighters и т.д.
  window.LUMEN = { game, view, player };
})();
