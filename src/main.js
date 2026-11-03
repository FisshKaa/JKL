'use strict';
(() => {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  const player = new PlayerController(game, canvas);
  const $ = s => document.querySelector(s);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lumen:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lumen:' + k, v); } catch (e) { /* без сохранения */ } },
  };

  let playerColor = store.get('color', CFG.BLADE_COLORS[0]);
  if (!CFG.BLADE_COLORS.includes(playerColor)) playerColor = CFG.BLADE_COLORS[0];
  let lastLevel = 'normal';
  let toastTimer = 0;

  const rivalColor = c => (c === '#ff4058' ? '#3fb8ff' : '#ff4058');
  const open = id => $(id).classList.add('visible');
  const close = id => $(id).classList.remove('visible');

  function applyAccent() {
    document.documentElement.style.setProperty('--accent', playerColor);
    document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-checked', String(s.dataset.color === playerColor)));
  }

  function startDemo() {
    game.fighters[0].name = 'Демо'; game.fighters[0].setColor(playerColor);
    game.fighters[1].name = 'Демо'; game.fighters[1].setColor(rivalColor(playerColor));
    game.startMatch('demo', [new BotController('normal'), new BotController('hard')]);
    document.body.classList.remove('playing');
  }

  function startVsBot(level) {
    lastLevel = level;
    game.fighters[0].name = 'Ты';
    game.fighters[0].setColor(playerColor);
    game.fighters[1].name = BOT_LEVELS[level].title;
    game.fighters[1].setColor(rivalColor(playerColor));
    player.reset();
    game.startMatch('bot', [player, new BotController(level)]);
    ['#menu', '#pause', '#result', '#controls'].forEach(close);
    document.body.classList.add('playing');
    if (document.activeElement) document.activeElement.blur();
    showToast();
  }

  function showToast() {
    const t = $('#toast');
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
  }

  function toMenu() {
    ['#pause', '#result'].forEach(close);
    $('#difficulty').classList.add('hidden');
    $('#main-actions').classList.remove('hidden');
    open('#menu');
    startDemo();
  }

  function setPaused(p) {
    if (game.mode !== 'bot' || game.state === 'matchEnd') return;
    game.paused = p;
    if (p) { open('#pause'); document.body.classList.remove('playing'); }
    else { close('#pause'); document.body.classList.add('playing'); player.reset(); }
  }

  game.onMatchEnd = winner => {
    if (game.mode === 'demo') { startDemo(); return; }
    $('#result-title').textContent = winner === 0 ? 'Победа' : 'Поражение';
    $('#result-score').textContent = `${game.scores[0]} : ${game.scores[1]}`;
    document.body.classList.remove('playing');
    open('#result');
  };

  // Палитра цветов клинка
  const sw = $('#swatches');
  CFG.BLADE_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = c;
    b.style.background = c;
    b.style.color = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Цвет ${c}`);
    b.addEventListener('click', () => {
      playerColor = c; store.set('color', c); applyAccent();
      if (game.mode === 'demo') { game.fighters[0].setColor(c); game.fighters[1].setColor(rivalColor(c)); }
    });
    sw.appendChild(b);
  });
  applyAccent();

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    const lvl = e.target.closest('[data-level]');
    if (lvl) { game.audio.ui(); startVsBot(lvl.dataset.level); return; }
    if (!a) return;
    game.audio.ui();
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
      setPaused(!game.paused);
    }
    if (e.code === 'KeyM') game.audio.setMuted(!game.audio.muted);
  });

  // Браузеры разрешают звук только после действия пользователя
  addEventListener('pointerdown', () => game.audio.init());
  addEventListener('keydown', () => game.audio.init());
  addEventListener('blur', () => setPaused(true));

  game.run();
  startDemo();
})();
