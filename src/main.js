'use strict';
(() => {
  const canvas = document.getElementById('game');
  const hudCanvas = document.getElementById('hud');
  const $ = s => document.querySelector(s);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lumen3d:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lumen3d:' + k, v); } catch (e) { /* без сохранения */ } },
  };

  let playerLook;
  try { playerLook = JSON.parse(store.get('look', 'null')); } catch (e) { playerLook = null; }
  if (!playerLook || !playerLook.colors) playerLook = cloneLook(LOOK_PRESETS.keeper);
  let botLook = randomLook();
  let playerColor = store.get('color', CFG.BLADE_COLORS[0]);
  if (!/^#[0-9a-f]{6}$/i.test(playerColor)) playerColor = CFG.BLADE_COLORS[0];
  let lastLevel = 'normal';

  const audio = new AudioFX();
  const game = new Game(null, audio);
  const player = new PlayerController(canvas);
  player.flickPx = +store.get('flick', 8);
  let view = null, hud = null;

  const open = id => $(id).classList.add('visible');
  const close = id => $(id).classList.remove('visible');
  const playing = () => game.mode === 'bot' && !game.paused && game.state !== 'matchEnd';
  const rivalColor = c => (c === '#ff4058' ? '#3fb8ff' : '#ff4058');

  // Сборка персонажей занимает около секунды: показываем экран и даём ему отрисоваться
  function withLoading(text, fn) {
    $('#loading-text').textContent = text;
    open('#loading');
    requestAnimationFrame(() => requestAnimationFrame(() => { try { fn(); } finally { close('#loading'); } }));
  }

  function lockPointer() {
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* не критично */ }
  }

  function applyColors() {
    document.documentElement.style.setProperty('--accent', playerColor);
    if (view) view.setColors();
  }

  function startDemo() {
    const [a, b] = game.fighters;
    a.name = 'Демо'; a.color = playerColor;
    b.name = 'Демо'; b.color = rivalColor(playerColor);
    view.setColors();
    game.startMatch('demo', [new BotController('hard'), new BotController('normal')]);
    view.chars.forEach(c => c.resetCloth());
    document.body.classList.remove('playing');
  }

  function startVsBot(level) {
    lastLevel = level;
    botLook = randomLook();
    withLoading('Готовим соперника…', () => {
      const [a, b] = game.fighters;
      a.name = 'Ты'; a.color = playerColor;
      b.name = BOT_LEVELS[level].title; b.color = rivalColor(playerColor);
      view.setLooks([playerLook, botLook]);
      view.setColors();
      player.reset(); player.lockOn = false; player.yaw = ARENA.spawns[0].yaw; player.pitch = 0;
      game.startMatch('bot', [player, new BotController(level)]);
      view.chars.forEach(c => c.resetCloth());
      ['#menu', '#pause', '#result', '#controls', '#custom'].forEach(close);
      document.body.classList.add('playing');
      if (document.activeElement) document.activeElement.blur();
      lockPointer();
      const t = $('#toast');
      t.classList.add('show');
      clearTimeout(startVsBot.tt);
      startVsBot.tt = setTimeout(() => t.classList.remove('show'), 7000);
    });
  }

  function setPaused(p) {
    if (game.mode !== 'bot' || game.state === 'matchEnd') return;
    game.paused = p;
    if (p) { open('#pause'); document.body.classList.remove('playing'); if (document.pointerLockElement) document.exitPointerLock(); }
    else { close('#pause'); document.body.classList.add('playing'); player.reset(); lockPointer(); }
  }

  function toMenu() {
    ['#pause', '#result', '#custom'].forEach(close);
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

  // ---------- Кастомизация ----------
  function openCustom() {
    close('#menu');
    game.mode = 'preview'; game.state = 'idle'; game.controllers = [null, null];
    const f = game.fighters[0];
    f.reset(0, 0, 0); f.ignite = 1; f.stance = DIR.RIGHT; f.color = playerColor;
    view.setColors();
    view.chars[0].resetCloth();
    renderCustom();
    open('#custom');
  }

  let rebuildT = 0;
  function changeLook(mut, geometry = true) {
    mut(playerLook);
    store.set('look', JSON.stringify(playerLook));
    renderCustom();
    if (!geometry) { view.setLook(0, playerLook); return; }
    clearTimeout(rebuildT);
    rebuildT = setTimeout(() => withLoading('Обновляем персонажа…', () => { view.setLook(0, playerLook); view.chars[0].resetCloth(); }), 250);
  }

  const seg = (label, opts, value, onPick) => {
    const w = document.createElement('div'); w.className = 'field';
    w.innerHTML = `<span class="field-label">${label}</span>`;
    const row = document.createElement('div'); row.className = 'seg';
    for (const [v, t] of opts) {
      const b = document.createElement('button');
      b.className = 'seg-btn'; b.textContent = t; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === value));
      b.addEventListener('click', () => onPick(v));
      row.appendChild(b);
    }
    w.appendChild(row);
    return w;
  };
  const swatches = (label, colors, value, onPick) => {
    const w = document.createElement('div'); w.className = 'field';
    w.innerHTML = `<span class="field-label">${label}</span>`;
    const row = document.createElement('div'); row.className = 'swatches';
    for (const c of colors) {
      const b = document.createElement('button');
      b.className = 'swatch'; b.style.background = c; b.style.color = c;
      b.setAttribute('aria-label', c); b.setAttribute('aria-checked', String(c === value));
      b.addEventListener('click', () => onPick(c));
      row.appendChild(b);
    }
    w.appendChild(row);
    return w;
  };
  const range = (label, value, onSet) => {
    const w = document.createElement('label'); w.className = 'field';
    w.innerHTML = `<span class="field-label">${label}</span>`;
    const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = value;
    r.addEventListener('change', () => onSet(+r.value));
    w.appendChild(r);
    return w;
  };
  const colorInput = (label, value, onSet) => {
    const w = document.createElement('label'); w.className = 'color-field';
    const i = document.createElement('input'); i.type = 'color'; i.value = value;
    i.addEventListener('input', () => onSet(i.value));
    w.appendChild(i);
    w.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
    return w;
  };

  let customTab = 'body';
  function renderCustom() {
    const L = playerLook, P = $('#custom-fields');
    P.innerHTML = '';
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === customTab)));
    const presets = document.createElement('div'); presets.className = 'presets';
    for (const [k, p] of Object.entries(LOOK_PRESETS)) {
      const b = document.createElement('button'); b.className = 'preset'; b.textContent = p.name;
      b.addEventListener('click', () => changeLook(l => Object.assign(l, cloneLook(p))));
      presets.appendChild(b);
    }
    if (customTab === 'body') {
      P.append(
        presets,
        seg('Телосложение', [['m', 'Мужское'], ['f', 'Женское']], L.sex, v => changeLook(l => { l.sex = v; if (v === 'f') l.beard = 'none'; })),
        range('Рост', L.height, v => changeLook(l => { l.height = v; })),
        range('Комплекция', L.build, v => changeLook(l => { l.build = v; })),
        swatches('Кожа', SKIN_TONES, L.skin, c => changeLook(l => { l.skin = c; })),
      );
    } else if (customTab === 'head') {
      P.append(
        seg('Лицо', [[0, 'Первое'], [1, 'Второе'], [2, 'Третье']], L.face, v => changeLook(l => { l.face = v; })),
        swatches('Глаза', EYE_COLORS, L.eyes, c => changeLook(l => { l.eyes = c; })),
        seg('Причёска', [['short', 'Короткая'], ['slick', 'Зачёс'], ['pony', 'Хвост'], ['long', 'Длинные'], ['bald', 'Без волос']], L.hair, v => changeLook(l => { l.hair = v; })),
        swatches('Цвет волос', HAIR_COLORS, L.hairColor, c => changeLook(l => { l.hairColor = c; })),
      );
      if (L.sex === 'm') P.append(seg('Борода', [['none', 'Нет'], ['stubble', 'Щетина'], ['full', 'Борода']], L.beard, v => changeLook(l => { l.beard = v; })));
    } else if (customTab === 'blade') {
      const pick = c => {
        playerColor = c; store.set('color', c);
        game.fighters[0].color = c; game.fighters[1].color = rivalColor(c);
        applyColors(); renderCustom();
      };
      P.append(swatches('Цвет клинка', CFG.BLADE_COLORS, playerColor, pick));
      const own = colorInput('Свой цвет', playerColor, c => { playerColor = c; store.set('color', c); game.fighters[0].color = c; applyColors(); });
      const w = document.createElement('div'); w.className = 'field'; w.appendChild(own);
      P.append(w);
    } else {
      P.append(
        seg('Верх', [['tunic', 'Туника'], ['vest', 'Безрукавка']], L.top, v => changeLook(l => { l.top = v; })),
        seg('Верхняя одежда', [['none', 'Нет'], ['robe', 'Мантия'], ['cape', 'Плащ']], L.outer, v => changeLook(l => { l.outer = v; })),
        seg('Полы туники', [[true, 'Есть'], [false, 'Нет']], L.tails, v => changeLook(l => { l.tails = v; })),
        seg('Кушак', [[true, 'Есть'], [false, 'Нет']], L.sash, v => changeLook(l => { l.sash = v; })),
        seg('Обмотки', [[true, 'Есть'], [false, 'Нет']], L.wraps, v => changeLook(l => { l.wraps = v; })),
        seg('Броня', [['none', 'Нет'], ['light', 'Лёгкая']], L.armor, v => changeLook(l => { l.armor = v; })),
      );
      const cw = document.createElement('div'); cw.className = 'field';
      cw.innerHTML = '<span class="field-label">Цвета</span>';
      const grid = document.createElement('div'); grid.className = 'color-grid';
      for (const [k, t] of [['tunic', 'Туника'], ['under', 'Рубаха'], ['sash', 'Кушак'], ['belt', 'Ремень'], ['trousers', 'Штаны'], ['boots', 'Сапоги'], ['outer', 'Мантия, плащ'], ['armor', 'Броня']]) {
        grid.appendChild(colorInput(t, L.colors[k], v => changeLook(l => { l.colors[k] = v; }, false)));
      }
      cw.appendChild(grid);
      P.append(cw);
    }
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { customTab = b.dataset.tab; renderCustom(); }));

  // Вращение превью мышью
  let dragX = null;
  canvas.addEventListener('pointerdown', e => { if (game.mode === 'preview') dragX = e.clientX; });
  addEventListener('pointerup', () => { dragX = null; });
  addEventListener('pointermove', e => { if (dragX !== null && view) { view.previewAng -= (e.clientX - dragX) * 0.01; dragX = e.clientX; } });
  canvas.addEventListener('wheel', e => { if (game.mode === 'preview' && view) view.previewZoom = clamp(view.previewZoom + e.deltaY * 0.001, 0.45, 1.6); }, { passive: true });

  // ---------- Меню ----------
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing()) setPaused(true); });
  canvas.addEventListener('click', () => { if (playing() && !document.pointerLockElement) lockPointer(); });

  const flick = $('#flick');
  flick.value = player.flickPx;
  $('#flick-value').textContent = `${player.flickPx} пикс.`;
  flick.addEventListener('input', () => {
    player.flickPx = +flick.value; store.set('flick', flick.value);
    $('#flick-value').textContent = `${flick.value} пикс.`;
  });

  document.addEventListener('click', e => {
    const lvl = e.target.closest('[data-level]');
    if (lvl) { audio.ui(); startVsBot(lvl.dataset.level); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    audio.ui();
    switch (a.dataset.action) {
      case 'vsbot': $('#main-actions').classList.add('hidden'); $('#difficulty').classList.remove('hidden'); break;
      case 'back': $('#difficulty').classList.add('hidden'); $('#main-actions').classList.remove('hidden'); break;
      case 'custom': openCustom(); break;
      case 'custom-done': toMenu(); break;
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

  // ---------- Запуск ----------
  withLoading('Собираем бойцов…', () => {
    view = new View(canvas, game, [playerLook, botLook]);
    game.fx = view.fx;
    hud = new HUD(hudCanvas);
    player.onStance = () => audio.tick();
    player.onToggle = text => hud.note(text);
    applyColors();
    startDemo();
    window.LUMEN = { game, view, player };
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      game.advance(dt);
      view.render(dt, player);
      hud.draw(game, view, player, dt);
      if (audio.ctx) {
        const [P, E] = game.fighters, sp = view.bladeSpeeds();
        const vol = game.paused ? 0 : game.mode === 'bot' ? 1 : 0.3;
        const r = rightOf(P.yaw), dx = E.x - P.x, dz = E.z - P.z, l = Math.hypot(dx, dz) || 1;
        audio.setHum(0, sp[0], P.ignite, 0, vol * 0.8);
        audio.setHum(1, sp[1], game.mode === 'preview' ? 0 : E.ignite, game.mode === 'bot' ? (dx * r.x + dz * r.z) / l : 0.3, vol * clamp(3 / l, 0.3, 1));
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
})();
